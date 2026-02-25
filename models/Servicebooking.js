/**
 * ServiceBooking.model.js  (v2)
 * ================================
 * Mongoose model for JCB outbound call outcomes.
 *
 * v2 additions:
 *   • rescheduledDateISO — machine-readable ISO date "2025-03-03"
 *   • callbackDateISO    — machine-readable ISO date "2025-03-03"
 *   Both fields let you sort/filter by real calendar dates in MongoDB.
 */

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/* ── Turn sub-schema ─────────────────────────────────────────────── */
const CallTurnSchema = new Schema(
  {
    turnNumber:   { type: Number, required: true },
    state:        { type: String, required: true },
    customerSaid: { type: String, default: ''   },
    confidence:   { type: Number, default: null },
    intent:       { type: String, default: null },
    systemReply:  { type: String, required: true },
  },
  { _id: false }
);

/* ── Main schema ─────────────────────────────────────────────────── */
const ServiceBookingSchema = new Schema(
  {
    /* Call metadata */
    callSid: {
      type: String, required: true, unique: true, index: true, trim: true,
    },

    /* Customer */
    customerName:  { type: String, required: true, trim: true },
    customerPhone: { type: String, default: null, index: true, trim: true },

    /* Machine / service */
    machineModel:    { type: String, required: true, trim: true },
    machineNumber:   { type: String, required: true, trim: true },
    serviceType:     { type: String, required: true, trim: true },
    dueDateOriginal: { type: String, required: true },

    /* Outcome */
    outcome: {
      type:     String,
      required: true,
      enum:     ['confirmed', 'rescheduled', 'callback', 'rejected', 'no_response'],
      index:    true,
    },

    /* ── Outcome-specific fields ───────────────────────────────── */

    // confirmed
    confirmedServiceDate: { type: String, default: null },

    // rescheduled
    rescheduledDate:    {
      type:    String,
      default: null,
      // Stores resolved display string e.g. "Monday, 3 March 2025"
    },
    rescheduledDateISO: {
      type:    String,
      default: null,
      // Stores ISO date string e.g. "2025-03-03" — sortable in MongoDB
    },

    // callback
    callbackDate:    {
      type:    String,
      default: null,
      // e.g. "Wednesday, 5 March 2025"
    },
    callbackDateISO: {
      type:    String,
      default: null,
      // e.g. "2025-03-05"
    },

    // rejected
    rejectionReason: { type: String, default: null },

    /* Call stats */
    totalTurns:          { type: Number, default: 0    },
    callDurationSeconds: { type: Number, default: null },

    /* Turn log */
    turns: { type: [CallTurnSchema], default: [] },

    /* Timestamps */
    callStartedAt: { type: Date, default: null },
    callEndedAt:   { type: Date, default: null },
  },
  {
    timestamps: true,  // createdAt + updatedAt
    versionKey: false,
  }
);

/* ── Indexes ─────────────────────────────────────────────────────── */
ServiceBookingSchema.index({ outcome: 1, createdAt: -1 });
ServiceBookingSchema.index({ customerPhone: 1, createdAt: -1 });
// Sort callbacks / reschedules by actual date in dashboards
ServiceBookingSchema.index({ rescheduledDateISO: 1 });
ServiceBookingSchema.index({ callbackDateISO: 1 });

/* ── Virtual ─────────────────────────────────────────────────────── */
ServiceBookingSchema.virtual('durationMinutes').get(function () {
  if (!this.callDurationSeconds) return null;
  return (this.callDurationSeconds / 60).toFixed(1);
});

/* ── Export ──────────────────────────────────────────────────────── */
const ServiceBooking =
  mongoose.models.ServiceBooking ||
  model('ServiceBooking', ServiceBookingSchema);

export default ServiceBooking;