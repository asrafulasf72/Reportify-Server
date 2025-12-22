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
    const paymentsCollection = db.collection("payments");


    /**Role Verify */
    const verifyAdmin = async (req, res, next) => {
      const email = req.decodedEmail;
      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Admin access only" });
      }

      next();
    };
    /** Staff Verify Middleware */
    const verifyStaff = async (req, res, next) => {
      const email = req.decodedEmail;

      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== "staff") {
        return res.status(403).send({ message: "Staff access only" });
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
    app.get("/users/:email/role", verifyFirebaseToken, async (req, res) => {
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
      if (user.isBlocked) {
        return res.status(403).send({ message: "You are blocked by admin" });
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

    /**Admin get  All Issues API Here  */

    app.get("/admin/issues", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const issues = await issuesCollaction.find().sort({ isBoosted: -1, createdAt: -1 })
        .toArray();

      res.send(issues);
    }
    );


    // Get All Staff
    app.get("/admin/staffs", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const staffs = await usersCollection
        .find({ role: "staff" })
        .toArray();
      res.send(staffs);
    }
    );

    // Post Staf IN DB
    app.post("/admin/staff", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { email, password, displayName, phone, photoURL } = req.body;

        if (!email || !password || !displayName) {
          return res.status(400).send({ message: "Missing required fields" });
        }

        const exists = await usersCollection.findOne({ email });
        if (exists) {
          return res.status(409).send({ message: "Staff already exists" });
        }

        //  Firebase user create
        const firebaseUser = await admin.auth().createUser({ email, password, displayName, photoURL });

        //  Save to DB
        const staff = {
          email,
          displayName,
          phone,
          photoURL,
          role: "staff",
          createdAt: new Date(),
        };

        await usersCollection.insertOne(staff);

        res.send({ success: true });
      } catch (error) {
        console.error("Create staff error:", error);

        // 🔥 Rollback Firebase user if DB fails
        if (req.body?.email) {
          try {
            const user = await admin.auth().getUserByEmail(req.body.email);
            await admin.auth().deleteUser(user.uid);
          } catch (e) { }
        }

        res.status(500).send({
          message: "Failed to create staff",
          error: error.message,
        });
      }
    }
    );


    // Update Staff 
    app.patch("/admin/staff/:email", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const email = req.params.email;
        const { displayName, phone, photoURL } = req.body;

        // 🔹 Firebase user update
        const user = await admin.auth().getUserByEmail(email);

        await admin.auth().updateUser(user.uid, {
          displayName,
          photoURL,
        });

        // 🔹 MongoDB update
        const result = await usersCollection.updateOne(
          { email },
          {
            $set: {
              displayName,
              phone,
              photoURL,
            },
          }
        );

        res.send({ success: true, result });
      } catch (error) {
        console.error("Update staff error:", error);
        res.status(500).send({ message: "Failed to update staff" });
      }
    });

    // Update staff profile
    app.patch("/staff/profile", verifyFirebaseToken, verifyStaff, async (req, res) => {
      try {
        const email = req.decodedEmail;
        const { displayName, photoURL } = req.body;

        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== "staff") {
          return res.status(403).send({ message: "Staff access only" });
        }

        // Update Firebase
        const firebaseUser = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(firebaseUser.uid, {
          displayName,
          photoURL,
        });

        // Update MongoDB
        const result = await usersCollection.updateOne(
          { email },
          { $set: { displayName, photoURL } }
        );

        res.send({ success: true, result });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Profile update failed" });
      }
    });

    // Get admin profile
    app.get("/admin/profile", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const email = req.decodedEmail;
      const adminUser = await usersCollection.findOne({ email });
      res.send(adminUser);
    });

    // Update admin profile
    app.patch("/admin/profile", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const email = req.decodedEmail;
      const { displayName, photoURL } = req.body;

      const firebaseUser = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(firebaseUser.uid, {
        displayName,
        photoURL,
      });

      const result = await usersCollection.updateOne(
        { email },
        { $set: { displayName, photoURL } }
      );

      res.send({ success: true, result });
    });

    // Get staff profile
    app.get("/staff/profile", verifyFirebaseToken, verifyStaff, async (req, res) => {
      try {
        const email = req.decodedEmail;

        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== "staff") {
          return res.status(403).send({ message: "Staff access only" });
        }

        res.send(user);
      } catch (error) {
        res.status(500).send({ message: "Failed to load profile" });
      }
    });

    // Assign issue to staff
    app.patch("/admin/issues/assign/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { staffEmail } = req.body;

      const issue = await issuesCollaction.findOne({ _id: new ObjectId(id) });
      if (!issue) {
        return res.status(404).send({ message: "Issue not found" });
      }

      const result = await issuesCollaction.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            assignedStaff: staffEmail,
            status: "pending",
          },
          $push: {
            timeline: {
              status: "assigned",
              message: `Issue assigned to staff (${staffEmail})`,
              updatedBy: "admin",
              date: new Date(),
            },
          },
        }
      );
      res.send(result);
    }
    );

    // Staff: get assigned issues
    app.get("/staff/assigned-issues", verifyFirebaseToken, verifyStaff, async (req, res) => {
      const email = req.decodedEmail;

      const user = await usersCollection.findOne({ email });
      if (!user || user.role !== "staff") {
        return res.status(403).send({ message: "Staff access only" });
      }

      const { status, priority } = req.query;

      let query = { assignedStaff: email, status: { $ne: "closed" } };

      if (status) query.status = status;
      if (priority) query.priority = priority;

      const issues = await issuesCollaction
        .find(query)
        .sort({ isBoosted: -1, createdAt: -1 })
        .toArray();

      res.send(issues);
    }
    );

    // Staff: change issue status
    app.patch("/staff/issues/status/:id", verifyFirebaseToken, verifyStaff, async (req, res) => {
      const email = req.decodedEmail;
      const { id } = req.params;
      const { status } = req.body;

      const user = await usersCollection.findOne({ email });
      if (!user || user.role !== "staff") {
        return res.status(403).send({ message: "Staff access only" });
      }

      const issue = await issuesCollaction.findOne({
        _id: new ObjectId(id),
      });

      if (!issue) {
        return res.status(404).send({ message: "Issue not found" });
      }

      if (issue.assignedStaff !== email) {
        return res.status(403).send({ message: "Not assigned to you" });
      }

      //  STATUS FLOW VALIDATION
      const allowedFlow = {
        pending: ["in-progress"],
        "in-progress": ["working"],
        working: ["resolved"],
        resolved: ["closed"],
      };

      if (!allowedFlow[issue.status]?.includes(status)) {
        return res.status(400).send({ message: "Invalid status change" });
      }

      const result = await issuesCollaction.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: { status },
          $push: {
            timeline: {
              status,
              message: `Status changed to ${status}`,
              updatedBy: "staff",
              date: new Date(),
            },
          },
        }
      );

      res.send(result);
    }
    );


    // Delete Staf
    app.delete("/admin/staff/:email", verifyFirebaseToken, verifyAdmin, async (req, res) => {
        const email = req.params.email;

        const result = await usersCollection.deleteOne({ email });
        res.send(result);
      }
    );



    // Issues Rejact API
    app.patch("/admin/issues/reject/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const issue = await issuesCollaction.findOne({ _id: new ObjectId(id) });

      if (issue.status !== "pending") {
        return res
          .status(400)
          .send({ message: "Only pending issues can be rejected" });
      }

      const result = await issuesCollaction.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: { status: "rejected" },
          $push: {
            timeline: {
              status: "rejected",
              message: "Issue rejected by admin",
              updatedBy: "admin",
              date: new Date(),
            },
          },
        }
      );

      res.send(result);
    }
    );

    /**Admin Get Users API  Here*/
    // Get all citizen users (Admin)
    app.get("/admin/users", verifyFirebaseToken, verifyAdmin, async (req, res) => {
        const users = await usersCollection
          .find({ role: "citizen" })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(users);
      }
    );


    // Block / Unblock user
    app.patch("/admin/users/block/:email", verifyFirebaseToken, verifyAdmin, async (req, res) => {
        const email = req.params.email;
        const { isBlocked } = req.body;

        const result = await usersCollection.updateOne(
          { email },
          { $set: { isBlocked } }
        );

        res.send(result);
      }
    );

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

    // Payment Success API
    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ success: false });
        }

        //  DUPLICATE CHECK
        const existingPayment = await paymentsCollection.findOne({
          paymentIntent: session.payment_intent
        });

        if (existingPayment) {
          return res.send({ success: true, message: "Already processed" });
        }

        const email = session.customer_email;

        const payment = {
          email,
          amount: session.amount_total / 100,
          currency: session.currency,
          paymentIntent: session.payment_intent,
          status: session.payment_status,
          type: "premium",
          createdAt: new Date(session.created * 1000),
          month: new Date(session.created * 1000).getMonth() + 1,
          year: new Date(session.created * 1000).getFullYear(),
        };

        await paymentsCollection.insertOne(payment);

        await usersCollection.updateOne(
          { email },
          { $set: { isPremium: true } }
        );

        res.send({ success: true });
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
      const email = req.decodedEmail;

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid") {
        return res.status(400).send({ message: "Payment not successful" });
      }

      //  DUPLICATE CHECK
      const exists = await paymentsCollection.findOne({
        paymentIntent: session.payment_intent
      });

      if (exists) {
        return res.send({ success: true, message: "Already processed" });
      }

      const issue = await issuesCollaction.findOne({
        _id: new ObjectId(issueId)
      });

      if (!issue || issue.isBoosted) {
        return res.status(400).send({ message: "Invalid issue" });
      }

      //  SAVE PAYMENT
      const payment = {
        email,
        amount: session.amount_total / 100,
        currency: session.currency,
        paymentIntent: session.payment_intent,
        status: session.payment_status,
        type: "boost",
        issueId,
        createdAt: new Date(session.created * 1000),
        month: new Date(session.created * 1000).getMonth() + 1,
        year: new Date(session.created * 1000).getFullYear(),
      };

      await paymentsCollection.insertOne(payment);

      // UPDATE ISSUE
      await issuesCollaction.updateOne(
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


    // Get all payments (Admin)
    app.get("/admin/payments", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const { email, month, year } = req.query;

      let query = {};

      if (email) {
        query.email = { $regex: email, $options: "i" };
      }

      if (month) {
        query.month = Number(month);
      }

      if (year) {
        query.year = Number(year);
      }

      const payments = await paymentsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      res.send(payments);
    }
    );


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

    // ================= ADMIN DASHBOARD STATS =================
    app.get("/admin/dashboard-stats", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const totalIssues = await issuesCollaction.countDocuments();

        const pendingIssues = await issuesCollaction.countDocuments({
          status: "pending",
        });

        const resolvedIssues = await issuesCollaction.countDocuments({
          status: "resolved",
        });

        const rejectedIssues = await issuesCollaction.countDocuments({
          status: "rejected",
        });

        const totalUsers = await usersCollection.countDocuments({role:"citizen"});

        // Total payment
        const payments = await paymentsCollection.find().toArray();
        const totalRevenue = payments.reduce(
          (sum, p) => sum + Number(p.amount || 0),
          0
        );

        // Latest data
        const latestIssues = await issuesCollaction
          .find()
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray();

        const latestPayments = await paymentsCollection
          .find()
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray();

        const latestUsers = await usersCollection
          .find({ role: "citizen" })
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray();

        res.send({
          stats: {
            totalIssues,
            pendingIssues,
            resolvedIssues,
            rejectedIssues,
            totalRevenue,
            totalUsers
          },
          latestIssues,
          latestPayments,
          latestUsers,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load dashboard stats" });
      }
    }
    );

    app.get("/admin/payment-chart", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const result = await paymentsCollection
        .aggregate([
          {
            $group: {
              _id: { month: "$month", year: "$year" },
              total: { $sum: "$amount" },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
        ])
        .toArray();

      res.send(result);
    }
    );

    // ================= CITIZEN DASHBOARD STATS =================
    app.get("/citizen/dashboard-stats", verifyFirebaseToken, async (req, res) => {
      try {
        const email = req.decodedEmail;

        const totalIssues = await issuesCollaction.countDocuments({
          citizenEmail: email,
        });

        const pendingIssues = await issuesCollaction.countDocuments({
          citizenEmail: email,
          status: "pending",
        });

        const inProgressIssues = await issuesCollaction.countDocuments({
          citizenEmail: email,
          status: "in-progress",
        });

        const resolvedIssues = await issuesCollaction.countDocuments({
          citizenEmail: email,
          status: "resolved",
        });

        const payments = await paymentsCollection
          .find({ email })
          .toArray();

        const totalPayments = payments.reduce(
          (sum, p) => sum + Number(p.amount || 0),
          0
        );

        res.send({
          totalIssues,
          pendingIssues,
          inProgressIssues,
          resolvedIssues,
          totalPayments,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load dashboard stats" });
      }
    });

    // ================= STAFF DASHBOARD STATS =================
    app.get("/staff/dashboard-stats", verifyFirebaseToken, verifyStaff, async (req, res) => {
      try {
        const email = req.decodedEmail;

        const user = await usersCollection.findOne({ email });
        if (!user || user.role !== "staff") {
          return res.status(403).send({ message: "Staff access only" });
        }

        const totalAssigned = await issuesCollaction.countDocuments({
          assignedStaff: email,
        });

        const resolvedCount = await issuesCollaction.countDocuments({
          assignedStaff: email,
          status: "resolved",
        });

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const todayTasks = await issuesCollaction.countDocuments({
          assignedStaff: email,
          createdAt: { $gte: todayStart },
        });

        const statusStats = await issuesCollaction.aggregate([
          { $match: { assignedStaff: email } },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ]).toArray();

        res.send({
          totalAssigned,
          resolvedCount,
          todayTasks,
          statusStats,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load staff dashboard stats" });
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