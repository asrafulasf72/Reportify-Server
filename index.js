const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion } = require('mongodb');

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
    const usersCollection=db.collection("users")



    // USers API Here 
    app.post('/users', async(req,res)=>{
      const user=req.body;
      user.role='citizen';
      user.subscription='free'
      user.createdAt = new Date().toISOString();
      const email=user.email;

      const userExist= await usersCollection.findOne({email})
      if(userExist){
         return res.send({ exists: true, message: 'User Already Exist' });
      }

      const result= await usersCollection.insertOne(user)
      res.send(result)
    })




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