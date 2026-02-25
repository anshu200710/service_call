/**
 * voice.routes.js
 * ================================
 * Thin Express router for JCB outbound service reminder voice calls.
 *
 * Mount in app.js:
 *   import voiceRoutes from './routes/voice.routes.js';
 *   app.use('/voice', voiceRoutes);
 *
 * Twilio webhook configuration:
 *   Call URL    → POST  {PUBLIC_URL}/voice
 *   Gather URL  → POST  {PUBLIC_URL}/voice/process
 *
 * This file contains ZERO business logic.
 * All logic lives in voice.service.js.
 */

import express from "express";
import VoiceService from "../controllers/voiceController.js";

const router = express.Router();

/**
 * POST /voice
 * Twilio fires this when the outbound call is first answered.
 * Responds with TwiML greeting + initial Gather prompt.
 */
router.post("/", (req, res) => VoiceService.handleInitialCall(req, res));

/**
 * POST /voice/process
 * Every <Gather> result posts here for all subsequent turns.
 * Drives the full state machine until the call ends.
 */
router.post("/process", (req, res) => VoiceService.handleUserInput(req, res));

export default router;
