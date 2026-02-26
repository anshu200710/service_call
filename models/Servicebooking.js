/**
 * ServiceBooking.model.js  (v3 — JSB Motors Advanced Flow)
 * ================================
 * Mongoose model for JSB Motors outbound call outcomes.
 *
 * v3 additions (over v2):
 *   • outcome enum updated  — added 'already_done'
 *   • assignedBranchName    — matched service center name
 *   • assignedBranchCode    — branch code e.g. "DEL01"
 *   • assignedBranchCity    — city of matched branch
 *   • confirmedServiceDate  — resolved display date for confirmed bookings
 *   • alreadyDoneDetails    — raw speech captured when customer says service already done
 *   • Removed rescheduled / callback fields (flow no longer uses them)
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
    /* ── Call metadata ───────────────────────────────────────────── */
    callSid: {
      type: String, required: true, unique: true, index: true, trim: true,
    },

    /* ── Customer ────────────────────────────────────────────────── */
    customerName:  { type: String, required: true, trim: true },
    customerPhone: { type: String, default: null,  index: true, trim: true },

    /* ── Machine / service ───────────────────────────────────────── */
    machineModel:    { type: String, required: true, trim: true },
    machineNumber:   { type: String, required: true, trim: true },
    serviceType:     { type: String, required: true, trim: true },
    dueDateOriginal: { type: String, required: true },

    /* ── Outcome ─────────────────────────────────────────────────── */
    outcome: {
      type:     String,
      required: true,
      enum:     ['confirmed', 'rejected', 'already_done', 'no_response'],
      index:    true,
    },

    /* ── confirmed ───────────────────────────────────────────────── */
    confirmedServiceDate: {
      type:    String,
      default: null,
      // Resolved display date e.g. "Monday, 3 March 2025"
    },
    confirmedServiceDateISO: {
      type:    String,
      default: null,
      // ISO-8601 e.g. "2025-03-03" — sortable in MongoDB
    },

    /* ── Branch assignment (populated on confirmed outcome) ──────── */
    assignedBranchName: {
      type:    String,
      default: null,
      trim:    true,
      // e.g. "Delhi Central"
    },
    assignedBranchCode: {
      type:    String,
      default: null,
      trim:    true,
      // e.g. "DEL01"
    },
    assignedBranchCity: {
      type:    String,
      default: null,
      trim:    true,
      // e.g. "Delhi"
    },

    /* ── rejected ────────────────────────────────────────────────── */
    rejectionReason: {
      type:    String,
      default: null,
      // Raw speech captured from customer when they reject
    },

    /* ── already_done ────────────────────────────────────────────── */
    alreadyDoneDetails: {
      type:    String,
      default: null,
      // Raw speech: "kab, kahan, kaunsi service karwai"
    },

    /* ── Call stats ──────────────────────────────────────────────── */
    totalTurns:          { type: Number, default: 0    },
    callDurationSeconds: { type: Number, default: null },

    /* ── Turn log ────────────────────────────────────────────────── */
    turns: { type: [CallTurnSchema], default: [] },

    /* ── Timestamps ──────────────────────────────────────────────── */
    callStartedAt: { type: Date, default: null },
    callEndedAt:   { type: Date, default: null },
  },
  {
    timestamps: true,   // adds createdAt + updatedAt automatically
    versionKey: false,
  }
);

/* ── Indexes ─────────────────────────────────────────────────────── */
ServiceBookingSchema.index({ outcome: 1, createdAt: -1 });
ServiceBookingSchema.index({ customerPhone: 1, createdAt: -1 });
ServiceBookingSchema.index({ assignedBranchCode: 1, createdAt: -1 });
ServiceBookingSchema.index({ confirmedServiceDateISO: 1 });

/* ── Virtuals ────────────────────────────────────────────────────── */
ServiceBookingSchema.virtual('durationMinutes').get(function () {
  if (!this.callDurationSeconds) return null;
  return (this.callDurationSeconds / 60).toFixed(1);
});

/* ── Export ──────────────────────────────────────────────────────── */
const ServiceBooking =
  mongoose.models.ServiceBooking ||
  model('ServiceBooking', ServiceBookingSchema);

export default ServiceBooking;