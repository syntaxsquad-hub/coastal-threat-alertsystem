// backend/models/index.js
const mongoose = require('mongoose');

// User Model
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  points: { type: Number, default: 100 },
  level: { type: String, default: 'Coastal Recruit' },
  badges: [{ type: String }],
  location: {
    lat: Number,
    lng: Number,
    address: String,
    accuracy: String
  },
  preferences: {
    notifications: {
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      ai: { type: Boolean, default: true },
      community: { type: Boolean, default: true }
    },
    language: { type: String, default: 'en' },
    units: { type: String, default: 'metric' },
    theme: { type: String, default: 'light' }
  },
  streak: { type: Number, default: 0 },
  lastActive: { type: Date, default: Date.now },
  emergencyContacts: [{
    name: String,
    phone: String,
    relationship: String
  }],
  verificationLevel: { type: String, default: 'basic' }, // basic, verified, expert
  createdAt: { type: Date, default: Date.now }
});

// Alert Model with geospatial indexing
const AlertSchema = new mongoose.Schema({
  type: { 
    type: String, 
    required: true,
    enum: ['cyclone', 'tsunami', 'flood', 'pollution', 'storm_surge', 'erosion', 'other']
  },
  severity: { 
    type: String, 
    required: true,
    enum: ['low', 'medium', 'high', 'critical']
  },
  title: { type: String, required: true },
  description: { type: String, required: true },
  coordinates: {
    type: { type: String, default: 'Point' },
    coordinates: [Number] // [longitude, latitude]
  },
  radius: { type: Number, default: 50 }, // affected radius in km
  eta: String,
  duration: String,
  confidence: { type: Number, min: 0, max: 100 },
  affectedPopulation: String,
  evacuationZones: [{
    name: String,
    radius: Number,
    priority: String,
    instructions: String
  }],
  emergencyContacts: [String],
  source: { type: String, required: true },
  aiPrediction: { type: Boolean, default: false },
  aiModelVersion: String,
  active: { type: Boolean, default: true },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  relatedAlerts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Alert' }],
  weatherData: mongoose.Schema.Types.Mixed,
  satelliteData: mongoose.Schema.Types.Mixed,
  historicalComparison: mongoose.Schema.Types.Mixed,
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, index: { expireAfterSeconds: 0 } }
});

// Create geospatial index for alerts
AlertSchema.index({ coordinates: '2dsphere' });

// Report Model
const ReportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    required: true,
    enum: ['erosion', 'pollution', 'weather', 'wildlife', 'infrastructure', 'tsunami', 'other']
  },
  severity: { 
    type: String, 
    required: true,
    enum: ['low', 'medium', 'high', 'critical']
  },
  title: String,
  description: { type: String, required: true },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: [Number], // [longitude, latitude]
    accuracy: String,
    address: String
  },
  attachments: [{
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    url: String,
    thumbnail: String,
    processed: { type: Boolean, default: false }
  }],
  verified: { type: Boolean, default: false },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verificationNotes: String,
  aiAnalysis: {
    severity: Number,
    confidence: Number,
    tags: [String],
    sentiment: String,
    credibility: Number,
    processedAt: Date,
    modelVersion: String
  },
  votes: {
    helpful: { type: Number, default: 0 },
    notHelpful: { type: Number, default: 0 },
    voters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  },
  comments: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: String,
    createdAt: { type: Date, default: Date.now }
  }],
  status: { 
    type: String, 
    default: 'pending',
    enum: ['pending', 'processing', 'verified', 'rejected', 'resolved']
  },
  followUp: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    update: String,
    attachments: [String],
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

// Create geospatial index for reports
ReportSchema.index({ location: '2dsphere' });

// Environmental Data Model
const EnvironmentalDataSchema = new mongoose.Schema({
  location: {
    type: { type: String, default: 'Point' },
    coordinates: [Number], // [longitude, latitude]
    name: String,
    stationId: String
  },
  data: {
    seaLevel: { value: Number, unit: String, trend: String },
    windSpeed: { value: Number, unit: String, direction: Number, gusts: Number },
    temperature: { value: Number, unit: String, feelsLike: Number },
    humidity: { value: Number, unit: String },
    pressure: { value: Number, unit: String, trend: String },
    waveHeight: { value: Number, unit: String, period: Number },
    waveDirection: Number,
    waterQuality: { 
      index: Number, 
      status: String, 
      pollutants: mongoose.Schema.Types.Mixed 
    },
    visibility: { value: Number, unit: String },
    precipitation: { value: Number, unit: String, type: String },
    uvIndex: Number,
    tideLevel: { value: Number, nextHigh: Date, nextLow: Date }
  },
  source: { 
    type: String, 
    required: true,
    enum: ['sensor', 'satellite', 'manual', 'api', 'simulation', 'buoy']
  },
  quality: {
    accuracy: Number,
    reliability: Number,
    completeness: Number
  },
  processed: { type: Boolean, default: false },
  anomalies: [{
    parameter: String,
    deviation: Number,
    significance: String
  }],
  timestamp: { type: Date, default: Date.now, index: true }
});

// Create indexes
EnvironmentalDataSchema.index({ location: '2dsphere' });
EnvironmentalDataSchema.index({ timestamp: -1 });
EnvironmentalDataSchema.index({ 'location.coordinates': 1, timestamp: -1 });

// Notification Model
const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { 
    type: String, 
    required: true,
    enum: ['alert', 'report', 'achievement', 'system', 'emergency', 'weather', 'community']
  },
  priority: { 
    type: String, 
    default: 'medium',
    enum: ['low', 'medium', 'high', 'critical']
  },
  channels: {
    push: { sent: Boolean, sentAt: Date, error: String },
    sms: { sent: Boolean, sentAt: Date, error: String },
    email: { sent: Boolean, sentAt: Date, error: String }
  },
  read: { type: Boolean, default: false },
  readAt: Date,
  actionUrl: String,
  actionLabel: String,
  metadata: {
    alertId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert' },
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },
    achievement: String,
    customData: mongoose.Schema.Types.Mixed
  },
  expiresAt: Date,
  createdAt: { type: Date, default: Date.now }
});

// Emergency Contact Model
const EmergencyContactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  number: { type: String, required: true },
  type: { 
    type: String, 
    required: true,
    enum: ['disaster_response', 'coast_guard', 'police', 'fire', 'medical', 'local_authority']
  },
  region: String,
  coordinates: {
    type: { type: String, default: 'Point' },
    coordinates: [Number]
  },
  availability: String,
  languages: [String],
  active: { type: Boolean, default: true }
});

// Evacuation Route Model
const EvacuationRouteSchema = new mongoose.Schema({
  name: { type: String, required: true },
  startPoint: {
    type: { type: String, default: 'Point' },
    coordinates: [Number]
  },
  endPoint: {
    type: { type: String, default: 'Point' },
    coordinates: [Number]
  },
  waypoints: [{
    type: { type: String, default: 'Point' },
    coordinates: [Number],
    instructions: String
  }],
  distance: Number,
  estimatedTime: Number,
  capacity: Number,
  roadCondition: String,
  trafficLevel: String,
  safetyRating: Number,
  alternativeRoutes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EvacuationRoute' }],
  restrictions: [String],
  lastUpdated: { type: Date, default: Date.now },
  active: { type: Boolean, default: true }
});

// Achievement Model
const AchievementSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  description: String,
  icon: String,
  category: String,
  points: Number,
  requirements: {
    type: String, // reports_count, streak_days, points_earned, etc.
    value: Number,
    timeframe: String
  },
  rarity: { 
    type: String,
    enum: ['common', 'uncommon', 'rare', 'epic', 'legendary']
  },
  active: { type: Boolean, default: true }
});

// User Achievement Model (junction table)
const UserAchievementSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  achievementId: { type: String, required: true },
  unlockedAt: { type: Date, default: Date.now },
  progress: Number,
  notified: { type: Boolean, default: false }
});

// System Log Model
const SystemLogSchema = new mongoose.Schema({
  level: { 
    type: String, 
    enum: ['info', 'warn', 'error', 'debug'],
    default: 'info'
  },
  category: String,
  message: String,
  data: mongoose.Schema.Types.Mixed,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ip: String,
  userAgent: String,
  timestamp: { type: Date, default: Date.now, index: true }
});

// Create and export models
const User = mongoose.model('User', UserSchema);
const Alert = mongoose.model('Alert', AlertSchema);
const Report = mongoose.model('Report', ReportSchema);
const EnvironmentalData = mongoose.model('EnvironmentalData', EnvironmentalDataSchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const EmergencyContact = mongoose.model('EmergencyContact', EmergencyContactSchema);
const EvacuationRoute = mongoose.model('EvacuationRoute', EvacuationRouteSchema);
const Achievement = mongoose.model('Achievement', AchievementSchema);
const UserAchievement = mongoose.model('UserAchievement', UserAchievementSchema);
const SystemLog = mongoose.model('SystemLog', SystemLogSchema);

module.exports = {
  User,
  Alert,
  Report,
  EnvironmentalData,
  Notification,
  EmergencyContact,
  EvacuationRoute,
  Achievement,
  UserAchievement,
  SystemLog
};
