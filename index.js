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
    const issueTimelineCollaction = db.collection("issueTimeline")



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

    /****************************************************************************************/
    /*Issues Related API*/

    // Issues Post Api here
    app.post('/issues', verifyFirebaseToken, async (req, res) => {
      const { title, description, category, location, image, email } = req.body;

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
        title: title,
        description: description,
        category: category,
        location: location,
        image: image,
        email: email,
        status: "pending",
        createdAt: new Date().toISOString()
      }

      const result = await issuesCollaction.insertOne(issue)

      //  TimeLine Record
      await issueTimelineCollaction.insertOne({
        issueId: result.insertedId,
        email,
        status: "Issue Reported",
        message: "Citizen  created the issue",
        createdAt: new Date(),
      });

      //  Increase user issue count
      await usersCollection.updateOne(
        { email },
        { $inc: { issueCount: 1 } }
      );
      res.send(result)
    })

    // Issue Get API

    app.get('/issues/:email', verifyFirebaseToken, async (req, res) => {
      const email = req.params.email
      if (email !== req.decodedEmail) {
        return res.status(403).send({ message: 'Forbidden access' })
      }
      const cursor = issuesCollaction.find({ email }).sort({ createdAt: -1 })
      const result = await cursor.toArray()
      res.send(result)
    })

    // Issues Update 

    app.patch("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const issue = await issuesCollaction.findOne({
        _id: new ObjectId(id),
      });

      // Only pending issues editable
      if (issue.status !== "pending") {
        return res.status(403).send({ message: "Cannot edit this issue" });
      }

      const result = await issuesCollaction.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );

      //  Timeline
      await issueTimelineCollaction.insertOne({
        issueId: new ObjectId(id),
        email: issue.email,
        action: "Issue Updated",
        date: new Date(),
      });

      res.send(result);
    });



    // Delete Issues API here
    app.delete("/issues/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      // 1️Find issue first
      const issue = await issuesCollaction.findOne(query);

      if (!issue) {
        return res.status(404).send({ message: "Issue not found" });
      }
      if (issue.email !== req.decodedEmail) {
        return res.status(403).send({ message: "Forbidden" })
      }
      //  Delete the issue
      const deleteIssueResult = await issuesCollaction.deleteOne(query);

      //  Delete all timeline records of this issue
      const deleteTimelineResult = await issueTimelineCollaction.deleteMany({
        issueId: new ObjectId(id),
      });

      //  Decrease user's issue count
      await usersCollection.updateOne(
        { email: issue.email },
        { $inc: { issueCount: -1 } }
      );

      res.send({
        success: true,
        deletedIssue: deleteIssueResult.deletedCount,
        deletedTimeline: deleteTimelineResult.deletedCount,
      });
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