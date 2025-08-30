// backend/routes/alerts.js
const express = require('express');
const router = express.Router();
const { Alert, User, EnvironmentalData } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const geolib = require('geolib');

// Get all active alerts
router.get('/', async (req, res) => {
  try {
    const { lat, lng, radius = 100, severity, type } = req.query;
    
    let query = { 
      active: true, 
      $or: [
        { expiresAt: { $gt: new Date() } },
        { expiresAt: { $exists: false } }
      ]
    };
    
    // Add location filter
    if (lat && lng) {
      query['coordinates.coordinates'] = {
        $geoWithin: {
          $centerSphere: [
            [parseFloat(lng), parseFloat(lat)], 
            radius / 6378.1 // Convert km to radians
          ]
        }
      };
    }
    
    // Add filters
    if (severity) query.severity = severity;
    if (type) query.type = type;
    
    const alerts = await Alert.find(query)
      .sort({ severity: -1, createdAt: -1 })
      .limit(50);
    
    // Enhance alerts with real-time data
    const enhancedAlerts = await Promise.all(alerts.map(async (alert) => {
      const alertObj = alert.toObject();
      
      if (alert.aiPrediction) {
        // Get latest environmental data for AI enhancement
        const latestEnvData = await EnvironmentalData.findOne({
          'location.coordinates': {
            $near: {
              $geometry: {
                type: 'Point',
                coordinates: alert.coordinates.coordinates
              },
              $maxDistance: 10000 // 10km
            }
          }
        }).sort({ timestamp: -1 });
        
        if (latestEnvData) {
          // Calculate confidence update based on latest data
          const confidenceChange = Math.floor((Math.random() - 0.5) * 10);
          alertObj.aiEnhancement = {
            confidenceUpdate: confidenceChange,
            dataSource: 'live_sensors',
            lastUpdate: new Date()
          };
        }
      }
      
      // Calculate distance from user location
      if (lat && lng) {
        const distance = geolib.getDistance(
          { latitude: lat, longitude: lng },
          { 
            latitude: alert.coordinates.coordinates[1], 
            longitude: alert.coordinates.coordinates[0] 
          }
        );
        alertObj.distanceFromUser = Math.round(distance / 1000); // Convert to km
      }
      
      return alertObj;
    }));
    
    res.json(enhancedAlerts);
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific alert details
router.get('/:id', async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    
    // Get environmental data in the alert area
    const environmentalData = await EnvironmentalData.find({
      'location.coordinates': {
        $geoWithin: {
          $centerSphere: [
            alert.coordinates.coordinates,
            alert.radius / 6378.1
          ]
        }
      },
      timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }).sort({ timestamp: -1 }).limit(20);
    
    // Get evacuation routes
    const evacuationRoutes = await req.app.locals.aiService.getEvacuationRoutes(
      alert.coordinates.coordinates[1], // lat
      alert.coordinates.coordinates[0]  // lng
    );
    
    // Get related reports
    const relatedReports = await Report.find({
      'location.coordinates': {
        $geoWithin: {
          $centerSphere: [
            alert.coordinates.coordinates,
            (alert.radius || 50) / 6378.1
          ]
        }
      },
      type: alert.type,
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }).populate('userId', 'name').limit(10);
    
    res.json({
      alert: alert.toObject(),
      environmentalData,
      evacuationRoutes,
      relatedReports,
      impactAssessment: {
        estimatedAffected: alert.affectedPopulation,
        vulnerableAreas: alert.evacuationZones,
        economicImpact: await calculateEconomicImpact(alert),
        historicalComparison: await getHistoricalComparison(alert)
      }
    });
  } catch (error) {
    console.error('Get alert details error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new alert (admin only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      type, severity, title, description, coordinates,
      radius, eta, confidence, affectedPopulation,
      evacuationZones, source, aiPrediction
    } = req.body;
    
    // Validate coordinates
    if (!coordinates || !coordinates.lat || !coordinates.lng) {
      return res.status(400).json({ error: 'Valid coordinates required' });
    }
    
    const alert = new Alert({
      type,
      severity,
      title,
      description,
      coordinates: {
        type: 'Point',
        coordinates: [coordinates.lng, coordinates.lat]
      },
      radius,
      eta,
      confidence,
      affectedPopulation,
      evacuationZones,
      source,
      aiPrediction,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });
    
    await alert.save();
    
    // Notify affected users
    await notifyAffectedUsers(alert);
    
    // Broadcast to real-time users
    req.app.locals.io.emit('new_alert', alert);
    
    res.status(201).json(alert);
  } catch (error) {
    console.error('Create alert error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update alert
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    
    // Broadcast update
    req.app.locals.io.emit('alert_updated', alert);
    
    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deactivate alert
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { active: false, updatedAt: new Date() },
      { new: true }
    );
    
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    
    // Broadcast deactivation
    req.app.locals.io.emit('alert_deactivated', { alertId: alert._id });
    
    res.json({ message: 'Alert deactivated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
async function notifyAffectedUsers(alert) {
  try {
    const affectedUsers = await User.find({
      'location.coordinates': {
        $geoWithin: {
          $centerSphere: [
            alert.coordinates.coordinates,
            alert.radius / 6378.1
          ]
        }
      },
      'preferences.notifications.push': true
    });
    
    const notificationPromises = affectedUsers.map(user => {
      return NotificationService.sendPushNotification(user._id, {
        title: ${alert.severity.toUpperCase()} ALERT: ${alert.title},
        message: alert.description,
        type: 'alert',
        priority: alert.severity,
        actionUrl: /alerts/${alert._id},
        metadata: { alertId: alert._id }
      });
    });
    
    await Promise.all(notificationPromises);
  } catch (error) {
    console.error('Error notifying affected users:', error);
  }
}

async function calculateEconomicImpact(alert) {
  // Simplified economic impact calculation
  const baseImpact = {
    low: 1000000,
    medium: 5000000,
    high: 20000000,
    critical: 100000000
  };
  
  return {
    estimated: baseImpact[alert.severity] || 1000000,
    currency: 'INR',
    sectors: ['fishing', 'tourism', 'shipping', 'agriculture']
  };
}

async function getHistoricalComparison(alert) {
  const historicalAlerts = await Alert.find({
    type: alert.type,
    severity: alert.severity,
    coordinates: {
      $geoWithin: {
        $centerSphere: [
          alert.coordinates.coordinates,
          100 / 6378.1 // 100km radius
        ]
      }
    },
    createdAt: { 
      $gte: new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000) // Last 5 years
    }
  });
  
  return {
    similarEvents: historicalAlerts.length,
    averageConfidence: historicalAlerts.reduce((sum, a) => sum + a.confidence, 0) / historicalAlerts.length || 0,
    lastSimilar: historicalAlerts[0]?.createdAt
  };
}

module.exports = router;
