const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

require('dotenv').config()
const app = express()
const port = process.env.PORT || 3000




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_Password}@myfirst-cluster.32i1hy9.mongodb.net/?appName=myfirst-cluster`;

//middleware
app.use(cors())
app.use(express.json())


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
      user.role = 'citizen'
      user.subscription = 'free'
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

    app.get('/users/:email', async (req, res) => {
      const email = req.params.email
      const result = await usersCollection.findOne({ email })
      res.send(result)
    })

    // Issues Post Api here
    app.post('/issues', async (req, res) => {
      const { title, description, category, location, image, email } = req.body;

      const user = await usersCollection.findOne({ email });
      if (user.subscription === "free" && user.issueCount >= 3) {
        return res.status(403).send({ message: "Limit reached" });
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

    app.get('/issues/:email', async (req, res) => {
      const email = req.params.email
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

      // ❌ Only pending issues editable
      if (issue.status !== "pending") {
        return res.status(403).send({ message: "Cannot edit this issue" });
      }

      const result = await issuesCollaction.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );

      // 🧾 Timeline
      await issueTimelineCollaction.insertOne({
        issueId: new ObjectId(id),
        email: issue.email,
        action: "Issue Updated",
        date: new Date(),
      });

      res.send(result);
    });



    // Delete Issues API here
    app.delete("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      // 1️Find issue first
      const issue = await issuesCollaction.findOne(query);

      if (!issue) {
        return res.status(404).send({ message: "Issue not found" });
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