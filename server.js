import express from 'express';
import dotenv from 'dotenv';
dotenv.config();
import outboundRoutes from './routes/outbound.js';
import voiceRoutes from './routes/voice.js';
import connectDB from './config/db.js';

const app = express();
const PORT = process.env.PORT ;


// REQUIRED — Twilio sends POST data as URL-encoded form, not JSON
app.use(express.urlencoded({ extended: false }));

// Also add JSON parser for your /call REST endpoint
app.use(express.json());

// Middleware
app.use(express.json());

app.use('/outbound', outboundRoutes)
app.use('/voice', voiceRoutes)


// Routes
app.get('/', (req, res) => {
    res.json({ message: 'Server is running' });
});

await connectDB();  // Connect to MongoDB before starting the server

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});