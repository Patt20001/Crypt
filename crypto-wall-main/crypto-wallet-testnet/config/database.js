const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');
    try {
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      if (!hello.setName && hello.msg !== 'isdbgrid') console.warn('⚠️ MongoDB is standalone. Wallet withdrawals, admin approvals and internal trading that use multi-document transactions require a replica set.');
      else console.log('✅ MongoDB transaction-capable topology detected');
    } catch (checkError) { console.warn('Could not verify MongoDB transaction support:', checkError.message); }
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;