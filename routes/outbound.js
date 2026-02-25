import express from 'express';
import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

// Temporary in-memory store
// (In production use Redis or DB)
const callDataStore = new Map();

const getTwilioClient = () => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio credentials are missing');
  }

  return twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
};

router.post('/call', async (req, res) => {
  const {
    to,
    customerName,
    machineModel,
    machineNumber,
    serviceType,
    dueDate
  } = req.body;

  if (!to) {
    return res.status(400).json({ error: '`to` phone number is required' });
  }

  try {
    const client = getTwilioClient();

    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${process.env.PUBLIC_URL}/voice`,
      method: 'POST'
    });

    // Store due data using CallSid
    callDataStore.set(call.sid, {
      customerName,
      machineModel,
      machineNumber,
      serviceType,
      dueDate
    });

    return res.json({
      success: true,
      callSid: call.sid
    });

  } catch (err) {
    console.error('Outbound call error:', err.message);

    return res.status(500).json({
      error: err.message
    });
  }
});

export { callDataStore };
export default router;