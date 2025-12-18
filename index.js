const express = require('express')
const cors = require('cors')
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const app = express()
const port = process.env.PORT || 3000

const admin = require("firebase-admin");
const serviceAccount = require("./reportify-firebase-adminsdk.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_Password}@myfirst-cluster.32i1hy9.mongodb.net/?appName=myfirst-cluster`;

//middleware
app.use(cors())
app.use(express.json())

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    return res.status(401).send({ message: 'Unauthorized' })
  }

  try {
    const token = authHeader.split(' ')[1]
    const decoded = await admin.auth().verifyIdToken(token)
    req.decodedEmail = decoded.email
    next()
  } catch (error) {
    return res.status(401).send({ message: 'Invalid token' })
  }
}


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //  Create database + collections
    const db = client.db("ReportifyDB")
    const usersCollection = db.collection("users")
    const issuesCollaction = db.collection("issues")


    const verifyAdmin = async (req, res, next) => {
      const email = req.decodedEmail;
      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Admin access only" });
      }

      next();
    };

    // USers API Here 
    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'citizen';
      user.isPremium = false;
      user.isBlocked = false;
      user.issueCount = 0;
      user.createdAt = new Date().toISOString();
      const email = user.email;

      const userExist = await usersCollection.findOne({ email })
      if (userExist) {
        return res.send({ exists: true, message: 'User Already Exist' });
      }

      const result = await usersCollection.insertOne(user)
      res.send(result)
    })
    // Get User API
    app.get('/users/:email', verifyFirebaseToken, async (req, res) => {
      const email = req.params.email
      if (email !== req.decodedEmail) {
        return res.status(403).send({ message: 'Forbidden access' })
      }
      const result = await usersCollection.findOne({ email })
      res.send(result)
    })

    // Update User API
    app.patch('/users/update/:email', verifyFirebaseToken, async (req, res) => {
      const email = req.params.email
      if (email !== req.decodedEmail) {
        return res.status(403).send({ message: 'Forbidden access' })
      }
      const { displayName, photoURL } = req.body

      const updateDoc = {
        $set: {
          displayName: displayName,
          photoURL: photoURL
        }
      }

      const result = await usersCollection.updateOne({ email }, updateDoc)
      res.send(result)
    })

    // Get User Role API 
    app.get("/users/:email/role", verifyFirebaseToken,async (req, res) => {
        const email = req.params.email;

        if (email !== req.decodedEmail) {
          return res.status(403).send({ message: "Forbidden" });
        }

        const user = await usersCollection.findOne({ email });

        res.send({ role: user?.role || "citizen" });
      }
    );

    /****************************************************************************************/
    /*Issues Related API*/

    // Issues Post Api here
    app.post('/issues', verifyFirebaseToken, async (req, res) => {
      const { title, description, category, location, image } = req.body;
      const email = req.decodedEmail;
      if (email !== req.decodedEmail) {
        return res.status(403).send({ message: 'Forbidden' })
      }
      const user = await usersCollection.findOne({ email });

      if (!user.isPremium && user.issueCount >= 3) {
        return res.status(403).send({
          message: "Free users can submit only 3 issues. Upgrade to premium."
        });
      }
      const issue = {
        title,
        description,
        category,
        location,
        image,

        citizenEmail: email,
        citizenName: user.displayName || "Citizen",

        status: "pending",
        priority: "normal",
        isBoosted: false,

        upvotes: [],
        upvoteCount: 0,

        assignedStaff: null,

        timeline: [
          {
            status: "pending",
            message: "Issue reported by citizen",
            updatedBy: "citizen",
            date: new Date()
          }
        ],

        createdAt: new Date()
      }
      const result = await issuesCollaction.insertOne(issue)

      //  Increase user issue count
      await usersCollection.updateOne(
        { email },
        { $inc: { issueCount: 1 } }
      );
      res.send(result)
    })

    // Issue Get API

    app.get('/issues/:email', verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decodedEmail) {
        return res.status(403).send({ message: 'Forbidden access' });
      }

      const result = await issuesCollaction
        .find({ citizenEmail: email })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    // Gingle Issues Get 

    app.get('/issues/details/:id', async (req, res) => {
      const { id } = req.params;

      const issue = await issuesCollaction.findOne({
        _id: new ObjectId(id)
      });

      if (!issue) {
        return res.status(404).send({ message: "Issue not found" });
      }

      res.send(issue);
    });


    // Get All Issues 
    app.get('/all-issues', async (req, res) => {
      try {
        const { search = "", category, status, priority, page = 1, limit = 6 } = req.query;
        let query = {};
        // SEARCH
        if (search.trim()) {
          query.$or = [
            { title: { $regex: search, $options: "i" } },
            { category: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } }
          ];
        }
        //  FILTER
        if (category) query.category = category;
        if (status) query.status = status;
        if (priority) query.priority = priority;

        const skip = (Number(page) - 1) * Number(limit);

        const total = await issuesCollaction.countDocuments(query);

        const issues = await issuesCollaction.find(query).sort({ isBoosted: -1, createdAt: -1 }).skip(skip).limit(Number(limit)).toArray();

        res.send({
          issues,
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: Number(page)
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load issues" });
      }
    });


    // Issues Update 

    app.patch('/issues/:id', verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const email = req.decodedEmail;
      const updatedData = req.body;

      const issue = await issuesCollaction.findOne({ _id: new ObjectId(id) });

      if (!issue) {
        return res.status(404).send({ message: "Issue not found" });
      }

      if (issue.citizenEmail !== email) {
        return res.status(403).send({ message: "Forbidden" });
      }

      if (issue.status !== "pending") {
        return res.status(403).send({ message: "Cannot edit this issue" });
      }

      const result = await issuesCollaction.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );

      res.send(result);
    });



    // Delete Issues API here
    app.delete('/issues/:id', verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const email = req.decodedEmail;

      const issue = await issuesCollaction.findOne({ _id: new ObjectId(id) });

      if (!issue) {
        return res.status(404).send({ message: "Issue not found" });
      }

      if (issue.citizenEmail !== email) {
        return res.status(403).send({ message: "Forbidden" });
      }

      await issuesCollaction.deleteOne({ _id: new ObjectId(id) });

      await usersCollection.updateOne(
        { email },
        { $inc: { issueCount: -1 } }
      );

      res.send({ success: true });
    });


    /****************************************************************************************/
    // Payment Related API here

    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body
      const amount = parseInt(paymentInfo.cost) * 100
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
              unit_amount: amount,
              product_data: {
                name: "Premium Subscription",
                description: "Unlimited Issue Submission",
              }

            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        customer_email: paymentInfo.email,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success/?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
      });
      res.send({ url: session.url });
    });

    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === "paid") {
          const email = session.customer_email;

          const result = await usersCollection.updateOne(
            { email },
            { $set: { isPremium: true } }
          );

          res.send({ success: true });
        } else {
          res.status(400).send({ success: false });
        }
      } catch (error) {
        res.status(500).send({ error: "Payment verification failed" });
      }
    });

    /**--------------------------------------------------------------------------------------- */
    app.post('/create-boost-session', verifyFirebaseToken, async (req, res) => {
      const { issueId } = req.body;
      const email = req.decodedEmail;

      const issue = await issuesCollaction.findOne({
        _id: new ObjectId(issueId)
      });

      if (!issue) {
        return res.status(404).send({ message: "Issue not found" });
      }

      if (issue.isBoosted) {
        return res.status(400).send({ message: "Issue already boosted" });
      }

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "bdt",
              unit_amount: 100 * 100,
              product_data: {
                name: "Issue Priority Boost",
                description: `Boost issue: ${issue.title}`,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        customer_email: email,
        success_url: `${process.env.SITE_DOMAIN}/issues/boost-success?session_id={CHECKOUT_SESSION_ID}&issueId=${issueId}`,
        cancel_url: `${process.env.SITE_DOMAIN}/issues/details/${issueId}`,
      });

      res.send({ url: session.url });
    });

    // Boost Succes API

    app.post('/boost-payment-success', verifyFirebaseToken, async (req, res) => {
      const { sessionId, issueId } = req.body;

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid") {
        return res.status(400).send({ message: "Payment not successful" });
      }

      const issue = await issuesCollaction.findOne({
        _id: new ObjectId(issueId)
      });

      if (!issue || issue.isBoosted) {
        return res.status(400).send({ message: "Invalid issue" });
      }

      const result = await issuesCollaction.updateOne(
        { _id: new ObjectId(issueId) },
        {
          $set: {
            isBoosted: true,
            priority: "high"
          },
          $push: {
            timeline: {
              status: "boosted",
              message: "Issue boosted by citizen (payment successful)",
              updatedBy: "citizen",
              date: new Date()
            }
          }
        }
      );

      res.send({ success: true });
    });

    // UpVote API
    app.patch('/issues/upvote/:id', verifyFirebaseToken, async (req, res) => {
      const issueId = req.params.id;
      const userEmail = req.decodedEmail;

      const issue = await issuesCollaction.findOne({
        _id: new ObjectId(issueId)
      });

      if (!issue) {
        return res.status(404).send({ message: "Issue not found" });
      }

      if (issue.citizenEmail === userEmail) {
        return res.status(403).send({ message: "You cannot upvote your own issue" });
      }

      if (issue.upvotes.includes(userEmail)) {
        return res.status(400).send({ message: "Already upvoted" });
      }

      const result = await issuesCollaction.updateOne(
        { _id: new ObjectId(issueId) },
        {
          $push: { upvotes: userEmail },
          $inc: { upvoteCount: 1 }
        }
      );

      res.send(result);
    });



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}

app.get('/', (req, res) => {
  res.send('Reportify Server Is Running!!!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
run().catch(console.dir);