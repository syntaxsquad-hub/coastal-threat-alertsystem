// backend/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const cron = require('node-cron');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const alertRoutes = require('./routes/alerts');
const reportRoutes = require('./routes/reports');
const environmentalRoutes = require('./routes/environmental');
const gamificationRoutes = require('./routes/gamification');
const notificationRoutes = require('./routes/notifications');

// Import services
const { DataSimulator } = require('./services/dataSimulator');
const { NotificationService } = require('./services/notificationService');
const { AIService } = require('./services/aiService');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use('/uploads', express.static('uploads'));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/coastal_sentinel', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Initialize services
const dataSimulator = new DataSimulator(io);
const notificationService = new NotificationService(io);
const aiService = new AIService();

// Make services available to routes
app.locals.dataSimulator = dataSimulator;
app.locals.notificationService = notificationService;
app.locals.aiService = aiService;
app.locals.io = io;

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/environmental', environmentalRoutes);
app.use('/api/gamification', gamificationRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date(),
    version: '1.0.0',
    services: {
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      aiService: 'active',
      realTimeData: 'active'
    }
  });
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_user_room', (userId) => {
    socket.join(user_${userId});
    console.log(User ${userId} joined their room);
  });

  socket.on('join_location_room', (coordinates) => {
    const locationRoom = location_${Math.floor(coordinates.lat)}_${Math.floor(coordinates.lng)};
    socket.join(locationRoom);
    console.log(User joined location room: ${locationRoom});
  });

  socket.on('request_realtime_data', (location) => {
    // Send initial data
    const environmentalData = dataSimulator.generateRealtimeData();
    socket.emit('environmental_update', environmentalData);
    
    // Subscribe to updates for this location
    socket.join(env_data_${Math.floor(location.lat)}_${Math.floor(location.lng)});
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Scheduled tasks
// Update environmental data every 30 seconds
cron.schedule('*/30 * * * * *', () => {
  const environmentalData = dataSimulator.generateRealtimeData();
  io.emit('environmental_update', environmentalData);
});

// Check for new threats every 2 minutes
cron.schedule('*/2 * * * *', async () => {
  try {
    await aiService.analyzeGlobalThreats();
  } catch (error) {
    console.error('Threat analysis error:', error);
  }
});

// Send daily summary notifications
cron.schedule('0 8 * * *', async () => {
  try {
    await notificationService.sendDailySummaries();
  } catch (error) {
    console.error('Daily summary error:', error);
  }
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(🌊 Coastal Sentinel Backend running on port ${PORT});
  console.log(🔗 Socket.IO server active);
  console.log(🤖 AI services initialized);
  
  // Start real-time data simulation
  dataSimulator.start();
});

module.exports = { app, io };
