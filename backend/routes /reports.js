// backend/routes/reports.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Report, User, Alert } = require('../models');
const { authenticateToken } = require('../middleware/auth');

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/reports';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|avi|mov|mp3|wav/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Submit new report
router.post('/', authenticateToken, upload.array('attachments', 5), async (req, res) => {
  try {
    const { type, severity, description, location, title } = req.body;
    const userId = req.user.userId;
    
    // Parse location if it's a string
    const parsedLocation = typeof location === 'string' ? JSON.parse(location) : location;
    
    if (!parsedLocation || !parsedLocation.lat || !parsedLocation.lng) {
      return res.status(400).json({ error: 'Valid location coordinates required' });
    }
    
    // Process attachments
    const attachments = req.files ? req.files.map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      url: /uploads/reports/${file.filename}
    })) : [];
    
    const report = new Report({
      userId,
      type,
      severity,
      title: title || ${type.charAt(0).toUpperCase() + type.slice(1)} Report,
      description,
      location: {
        type: 'Point',
        coordinates: [parsedLocation.lng, parsedLocation.lat],
        accuracy: parsedLocation.accuracy,
        address: parsedLocation.address
      },
      attachments
    });
    
    await report.save();
    
    // Call AI analysis service
    try {
      const aiAnalysis = await req.app.locals.aiService.analyzeReport(report);
      report.aiAnalysis = aiAnalysis;
      await report.save();
    } catch (aiError) {
      console.error('AI analysis failed:', aiError);
    }
    
    // Award points based on report type and attachments
    const pointsMap = {
      erosion: 15, pollution: 20, weather: 25, 
      wildlife: 10, infrastructure: 15, tsunami: 50
    };
    
    const basePoints = pointsMap[type] || 10;
    const evidenceBonus = attachments.length * 5;
    const severityMultiplier = { low: 1, medium: 1.2, high: 1.5, critical: 2 };
    const totalPoints = Math.floor((basePoints + evidenceBonus) * severityMultiplier[severity]);
    
    // Update user points and check for achievements
    const user = await User.findByIdAndUpdate(
      userId, 
      { 
        $inc: { points: totalPoints },
        lastActive: new Date()
      },
      { new: true }
    );
    
    // Check for streak and achievements
    await checkAndUpdateStreak(userId);
    await checkAchievements(userId);
    
    // Auto-generate alert if critical severity and AI confirms
    if (severity === 'critical' && report.aiAnalysis?.confidence > 80) {
      await autoGenerateAlert(report);
    }
    
    // Notify nearby users
    await notifyNearbyUsers(report);
    
    // Broadcast to real-time users
    req.app.locals.io.emit('new_report', {
      report: report.toObject(),
      user: { name: user.name, level: user.level }
    });
    
    res.status(201).json({ 
      report: report.toObject(),
      pointsEarned: totalPoints,
      newTotal: user.points,
      message: Report submitted successfully! You earned ${totalPoints} points.
    });
  } catch (error) {
    console.error('Submit report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get reports with filters
router.get('/', async (req, res) => {
  try {
    const { 
      lat, lng, radius = 50, type, severity, 
      verified, userId, limit = 20, page = 1 
    } = req.query;
    
    let query = {};
    
    // Location filter
    if (lat && lng) {
      query['location.coordinates'] = {
        $geoWithin: {
          $centerSphere: [
            [parseFloat(lng), parseFloat(lat)], 
            radius / 6378.1
          ]
        }
      };
    }
    
    // Other filters
    if (type) query.type = type;
    if (severity) query.severity = severity;
    if (verified !== undefined) query.verified = verified === 'true';
    if (userId) query.userId = userId;
    
    const skip = (page - 1) * limit;
    
    const reports = await Report.find(query)
      .populate('userId', 'name level badges')
      .populate('verifiedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Report.countDocuments(query);
    
    res.json({
      reports,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific report
router.get('/:id', async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate('userId', 'name level badges points')
      .populate('verifiedBy', 'name level')
      .populate('comments.userId', 'name level');
    
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify report (admin/expert only)
router.put('/:id/verify', authenticateToken, async (req, res) => {
  try {
    const { verified, notes } = req.body;
    const verifierId = req.user.userId;
    
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { 
        verified,
        verifiedBy: verifierId,
        verificationNotes: notes,
        status: verified ? 'verified' : 'rejected'
      },
      { new: true }
    ).populate('userId', 'name');
    
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    // Award bonus points for verified reports
    if (verified) {
      await User.findByIdAndUpdate(report.userId._id, {
        $inc: { points: 25 }
      });
      
      // Notify report author
      await req.app.locals.notificationService.sendPushNotification(report.userId._id, {
        title: 'Report Verified!',
        message: Your ${report.type} report has been verified. +25 bonus points!,
        type: 'achievement',
        priority: 'medium'
      });
    }
    
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Vote on report helpfulness
router.post('/:id/vote', authenticateToken, async (req, res) => {
  try {
    const { helpful } = req.body;
    const userId = req.user.userId;
    const reportId = req.params.id;
    
    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    // Check if user already voted
    if (report.votes.voters.includes(userId)) {
      return res.status(400).json({ error: 'You have already voted on this report' });
    }
    
    // Update vote count
    if (helpful) {
      report.votes.helpful += 1;
    } else {
      report.votes.notHelpful += 1;
    }
    
    report.votes.voters.push(userId);
    await report.save();
    
    // Award points to report author if helpful vote
    if (helpful) {
      await User.findByIdAndUpdate(report.userId, {
        $inc: { points: 2 }
      });
    }
    
    res.json({ 
      votes: report.votes,
      message: 'Vote recorded successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add comment to report
router.post('/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user.userId;
    
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      {
        $push: {
          comments: {
            userId,
            message,
            createdAt: new Date()
          }
        }
      },
      { new: true }
    ).populate('comments.userId', 'name level');
    
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    // Notify report author
    if (report.userId.toString() !== userId) {
      await req.app.locals.notificationService.sendPushNotification(report.userId, {
        title: 'New Comment on Your Report',
        message: Someone commented on your ${report.type} report,
        type: 'community',
        priority: 'low',
        actionUrl: /reports/${report._id}
      });
    }
    
    res.json(report.comments[report.comments.length - 1]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
async function checkAndUpdateStreak(userId) {
  try {
    const user = await User.findById(userId);
    const today = new Date().setHours(0, 0, 0, 0);
    const yesterday = new Date(today - 24 * 60 * 60 * 1000);
    
    const todayReports = await Report.countDocuments({
      userId,
      createdAt: { $gte: today }
    });
    
    const yesterdayReports = await Report.countDocuments({
      userId,
      createdAt: { $gte: yesterday, $lt: today }
    });
    
    if (todayReports > 0) {
      if (yesterdayReports > 0) {
        // Continue streak
        user.streak += 1;
      } else {
        // Reset streak
        user.streak = 1;
      }
      await user.save();
    }
  } catch (error) {
    console.error('Streak update error:', error);
  }
}

async function checkAchievements(userId) {
  try {
    const user = await User.findById(userId);
    const totalReports = await Report.countDocuments({ userId });
    const verifiedReports = await Report.countDocuments({ userId, verified: true });
    
    const achievements = [];
    
    // First report achievement
    if (totalReports === 1 && !user.badges.includes('First Reporter')) {
      achievements.push('First Reporter');
    }
    
    // Weather watcher (10 weather reports)
    const weatherReports = await Report.countDocuments({ userId, type: 'weather' });
    if (weatherReports >= 10 && !user.badges.includes('Weather Watcher')) {
      achievements.push('Weather Watcher');
    }
    
    // Community hero (100 total reports)
    if (totalReports >= 100 && !user.badges.includes('Community Hero')) {
      achievements.push('Community Hero');
    }
    
    // Accuracy expert (80% verification rate)
    if (totalReports >= 20 && (verifiedReports / totalReports) >= 0.8 && !user.badges.includes('Accuracy Expert')) {
      achievements.push('Accuracy Expert');
    }
    
    // Streak master (30-day streak)
    if (user.streak >= 30 && !user.badges.includes('Streak Master')) {
      achievements.push('Streak Master');
    }
    
    // Update user badges and award points
    if (achievements.length > 0) {
      const achievementPoints = achievements.length * 100;
      user.badges.push(...achievements);
      user.points += achievementPoints;
      await user.save();
      
      // Send achievement notification
      achievements.forEach(async (achievement) => {
        await req.app.locals.notificationService.sendPushNotification(userId, {
          title: 'Achievement Unlocked!',
          message: You earned the "${achievement}" badge! +100 points,
          type: 'achievement',
          priority: 'medium'
        });
      });
    }
  } catch (error) {
    console.error('Achievement check error:', error);
  }
}

async function autoGenerateAlert(report) {
  try {
    if (report.aiAnalysis?.confidence < 80) return;
    
    const alert = new Alert({
      type: report.type,
      severity: report.severity,
      title: Community Alert: ${report.title},
      description: Critical ${report.type} reported by community member. ${report.description},
      coordinates: report.location,
      radius: 25,
      eta: 'Immediate',
      confidence: report.aiAnalysis.confidence,
      affectedPopulation: '50K+',
      evacuationZones: ['Immediate area (0-5km)'],
      source: 'Community Report (AI Verified)',
      aiPrediction: true,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000) // 12 hours
    });
    
    await alert.save();
    
    // Broadcast new alert
    req.app.locals.io.emit('auto_generated_alert', alert);
  } catch (error) {
    console.error('Auto alert generation error:', error);
  }
}

async function notifyNearbyUsers(report) {
  try {
    if (report.severity === 'low') return;
    
    const nearbyUsers = await User.find({
      'location.coordinates': {
        $geoWithin: {
          $centerSphere: [
            report.location.coordinates,
            10 / 6378.1 // 10km radius
          ]
        }
      },
      'preferences.notifications.community': true,
      _id: { $ne: report.userId } // Exclude report author
    });
    
    const notifications = nearbyUsers.map(user => 
      req.app.locals.notificationService.sendPushNotification(user._id, {
        title: ${report.severity.toUpperCase()} Report Nearby,
        message: ${report.type} reported within 10km of your location,
        type: 'community',
        priority: report.severity,
        actionUrl: /reports/${report._id}
      })
    );
    
    await Promise.all(notifications);
  } catch (error) {
    console.error('Nearby notification error:', error);
  }
}

module.exports = router;
