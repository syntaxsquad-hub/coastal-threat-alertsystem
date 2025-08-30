// backend/services/notificationService.js
const { Notification, User } = require('../models');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const admin = require('firebase-admin');

class NotificationService {
  constructor(io) {
    this.io = io;
    this.setupEmailTransporter();
    this.setupSMSClient();
    this.setupFirebase();
  }

  setupEmailTransporter() {
    this.emailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }

  setupSMSClient() {
    if (process.env.TWILIO_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.smsClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
    }
  }

  setupFirebase() {
    try {
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        this.fcm = admin.messaging();
      }
    } catch (error) {
      console.error('Firebase setup error:', error);
    }
  }

  async sendPushNotification(userId, notification) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.preferences.notifications.push) {
        return false;
      }

      // Save notification to database
      const dbNotification = new Notification({
        userId,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        priority: notification.priority,
        actionUrl: notification.actionUrl,
        metadata: notification.metadata
      });

      await dbNotification.save();

      // Send via WebSocket (real-time)
      this.io.to(`user_${userId}`).emit('notification', {
        id: dbNotification._id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        priority: notification.priority,
        timestamp: new Date(),
        actionUrl: notification.actionUrl
      });

      // Send via Firebase FCM if available
      if (this.fcm && user.fcmToken) {
        try {
          await this.fcm.send({
            token: user.fcmToken,
            notification: {
              title: notification.title,
              body: notification.message
            },
            data: {
              type: notification.type,
              priority: notification.priority,
              actionUrl: notification.actionUrl || ''
            },
            android: {
              priority: notification.priority === 'critical' ? 'high' : 'normal',
              notification: {
                channelId: notification.type,
                sound: notification.priority === 'critical' ? 'emergency' : 'default'
              }
            },
            apns: {
              payload: {
                aps: {
                  sound: notification.priority === 'critical' ? 'emergency.wav' : 'default'
                }
              }
            }
          });

          dbNotification.channels.push = { sent: true, sentAt: new Date() };
        } catch (fcmError) {
          console.error('FCM error:', fcmError);
          dbNotification.channels.push = { sent: false, error: fcmError.message };
        }
      }

      await dbNotification.save();
      return true;
    } catch (error) {
      console.error('Push notification error:', error);
      return false;
    }
  }

  async sendSMS(phoneNumber, message, priority = 'medium') {
    try {
      if (!this.smsClient) {
        console.warn('SMS client not configured');
        return false;
      }

      const result = await this.smsClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber,
        priority: priority === 'critical' ? 'high' : undefined
      });

      console.log(`SMS sent successfully: ${result.sid}`);
      return true;
    } catch (error) {
      console.error('SMS error:', error);
      return false;
    }
  }

  async sendEmail(email, subject, htmlContent, priority = 'medium') {
    try {
      await this.emailTransporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject,
        html: htmlContent,
        priority: priority === 'critical' ? 'high' : 'normal'
      });

      return true;
    } catch (error) {
      console.error('Email error:', error);
      return false;
    }
  }

  async sendEmergencyAlert(userId, alert) {
    try {
      const user = await User.findById(userId);
      if (!user) return false;

      const message = `🚨 EMERGENCY ALERT: ${alert.title}\n\n${alert.description}\n\nETA: ${alert.eta}\nCall 108 for immediate help.`;
      const subject = `CRITICAL ALERT: ${alert.title}`;

      const emailHtml = `
        <div style="background: linear-gradient(135deg, #dc2626, #ef4444); color: white; padding: 20px; border-radius: 10px; font-family: Arial, sans-serif;">
          <h1 style="margin: 0 0 15px 0;">🚨 EMERGENCY ALERT</h1>
          <h2 style="margin: 0 0 15px 0;">${alert.title}</h2>
          <p style="font-size: 16px; margin: 0 0 20px 0;">${alert.description}</p>
          
          <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p><strong>ETA:</strong> ${alert.eta}</p>
            <p><strong>Confidence:</strong> ${alert.confidence}%</p>
            <p><strong>Affected Population:</strong> ${alert.affectedPopulation}</p>
          </div>
          
          <div style="background: rgba(255,255,255,0.9); color: #dc2626; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0;">IMMEDIATE ACTIONS:</h3>
            <ul>
              <li>Call 108 for emergency assistance</li>
              <li>Follow evacuation orders immediately</li>
              <li>Alert family and neighbors</li>
              <li>Move to higher ground if possible</li>
            </ul>
          </div>
          
          <p style="font-size: 14px; opacity: 0.9;">
            This alert was generated by Coastal Sentinel AI system with ${alert.confidence}% confidence.
            Source: ${alert.source}
          </p>
        </div>
      `;

      // Send via all channels for critical alerts
      const promises = [];

      if (user.preferences.notifications.push) {
        promises.push(this.sendPushNotification(userId, {
          title: alert.title,
          message: alert.description,
          type: 'emergency',
          priority: 'critical',
          actionUrl: `/alerts/${alert._id}`
        }));
      }

      if (user.preferences.notifications.sms && user.phone) {
        promises.push(this.sendSMS(user.phone, message, 'critical'));
      }

      if (user.preferences.notifications.email && user.email) {
        promises.push(this.sendEmail(user.email, subject, emailHtml, 'critical'));
      }

      await Promise.all(promises);
      return true;
    } catch (error) {
      console.error('Emergency alert error:', error);
      return false;
    }
  }

  async sendBulkAlert(userIds, alert) {
    try {
      const batchSize = 100;
      const batches = [];

      for (let i = 0; i < userIds.length; i += batchSize) {
        batches.push(userIds.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        const promises = batch.map(userId =>
          this.sendEmergencyAlert(userId, alert)
        );

        await Promise.all(promises);

        // Small delay between batches to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`Bulk alert sent to ${userIds.length} users`);
      return true;
    } catch (error) {
      console.error('Bulk alert error:', error);
      return false;
    }
  }

  async sendDailySummary(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) return false;

      const today = new Date();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

      // Get user's reports from yesterday
      const Report = require('../models').Report;
      const userReports = await Report.find({
        userId,
        createdAt: { $gte: yesterday, $lt: today }
      });

      // Get nearby alerts
      const Alert = require('../models').Alert;
      const nearbyAlerts = await Alert.find({
        active: true,
        'coordinates.coordinates': {
          $geoWithin: {
            $centerSphere: [
              [user.location.lng, user.location.lat],
              50 / 6378.1 // 50km radius
            ]
          }
        }
      });

      const summary = {
        reports_submitted: userReports.length,
        points_earned: userReports.reduce((sum, report) => sum + (report.pointsEarned || 0), 0),
        nearby_alerts: nearbyAlerts.length,
        streak: user.streak,
        level: user.level
      };

      const htmlContent = this.generateDailySummaryHTML(user.name, summary);

      await this.sendEmail(
        user.email,
        'Your Daily Coastal Sentinel Summary',
        htmlContent,
        'low'
      );

      return true;
    } catch (error) {
      console.error('Daily summary error:', error);
      return false;
    }
  }

  generateDailySummaryHTML(userName, summary) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #3b82f6, #1e40af); color: white; padding: 30px; text-align: center;">
          <h1>Daily Coastal Sentinel Summary</h1>
          <p>Hello ${userName}!</p>
        </div>
        
        <div style="padding: 30px; background: #f8fafc;">
          <h2>Yesterday's Activity</h2>
          
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin: 20px 0;">
            <div style="background: white; padding: 20px; border-radius: 10px; text-align: center; border: 2px solid #e2e8f0;">
              <h3 style="color: #059669; margin: 0;">Reports Submitted</h3>
              <p style="font-size: 2em; font-weight: bold; margin: 10px 0; color: #059669;">${summary.reports_submitted}</p>
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 10px; text-align: center; border: 2px solid #e2e8f0;">
              <h3 style="color: #7c3aed; margin: 0;">Points Earned</h3>
              <p style="font-size: 2em; font-weight: bold; margin: 10px 0; color: #7c3aed;">${summary.points_earned}</p>
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 10px; text-align: center; border: 2px solid #e2e8f0;">
              <h3 style="color: #dc2626; margin: 0;">Nearby Alerts</h3>
              <p style="font-size: 2em; font-weight: bold; margin: 10px 0; color: #dc2626;">${summary.nearby_alerts}</p>
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 10px; text-align: center; border: 2px solid #e2e8f0;">
              <h3 style="color: #ea580c; margin: 0;">Current Streak</h3>
              <p style="font-size: 2em; font-weight: bold; margin: 10px 0; color: #ea580c;">${summary.streak} days</p>
            </div>
          </div>
          
          <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <h3>Current Status</h3>
            <p>Level: <strong>${summary.level}</strong></p>
            <p>Keep up the great work protecting our coastal communities!</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" 
               style="background: #3b82f6; color: white; padding: 15px 30px; text-decoration: none; border-radius: 10px; font-weight: bold;">
              Open Coastal Sentinel App
            </a>
          </div>
        </div>
        
        <div style="background: #1e293b; color: white; padding: 20px; text-align: center;">
          <p style="margin: 0;">Stay safe and keep watching the coast!</p>
          <p style="font-size: 0.8em; margin: 5px 0 0 0;">Coastal Sentinel Team</p>
        </div>
      </div>
    `;
  }

  async sendWeatherAlert(users, weatherData, alertType) {
    try {
      const title = this.getWeatherAlertTitle(alertType, weatherData);
      const message = this.getWeatherAlertMessage(alertType, weatherData);

      const notifications = users.map(user =>
        this.sendPushNotification(user._id, {
          title,
          message,
          type: 'weather',
          priority: this.getWeatherPriority(weatherData),
          metadata: { weatherData, alertType }
        })
      );

      await Promise.all(notifications);
      return true;
    } catch (error) {
      console.error('Weather alert error:', error);
      return false;
    }
  }

  getWeatherAlertTitle(type, data) {
    const titles = {
      'high_wind': `High Wind Warning - ${data.windSpeed}km/h`,
      'low_pressure': `Low Pressure Alert - ${data.pressure}hPa`,
      'high_waves': `High Wave Warning - ${data.waveHeight}m`,
      'temperature_extreme': `Extreme Temperature - ${data.temperature}°C`
    };

    return titles[type] || 'Weather Alert';
  }

  getWeatherAlertMessage(type, data) {
    const messages = {
      'high_wind': `Dangerous wind speeds of ${data.windSpeed}km/h detected. Secure loose objects and avoid coastal areas.`,
      'low_pressure': `Extremely low pressure of ${data.pressure}hPa indicates severe weather approaching.`,
      'high_waves': `Wave heights of ${data.waveHeight}m pose significant coastal threat.`,
      'temperature_extreme': `Extreme temperature of ${data.temperature}°C may affect weather patterns.`
    };

    return messages[type] || 'Unusual weather conditions detected.';
  }

  getWeatherPriority(data) {
    if (data.windSpeed > 100 || data.pressure < 980 || data.waveHeight > 5) {
      return 'critical';
    } else if (data.windSpeed > 60 || data.pressure < 1000 || data.waveHeight > 3) {
      return 'high';
    } else {
      return 'medium';
    }
  }

  async sendAchievementNotification(userId, achievement) {
    try {
      const user = await User.findById(userId);
      if (!user) return false;

      await this.sendPushNotification(userId, {
        title: 'Achievement Unlocked!',
        message: `Congratulations! You earned the "${achievement.name}" badge and ${achievement.points} points!`,
        type: 'achievement',
        priority: 'medium',
        metadata: { achievement }
      });

      // Send celebratory email for major achievements
      if (achievement.points >= 500) {
        const htmlContent = `
          <div style="text-align: center; padding: 40px; font-family: Arial, sans-serif;">
            <div style="background: linear-gradient(135deg, #7c3aed, #a855f7); color: white; padding: 30px; border-radius: 20px; margin-bottom: 30px;">
              <h1 style="margin: 0;">🏆 Major Achievement Unlocked!</h1>
              <h2 style="margin: 10px 0;">${achievement.name}</h2>
              <p style="font-size: 18px;">${achievement.description}</p>
              <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px; margin: 20px 0;">
                <span style="font-size: 24px; font-weight: bold;">+${achievement.points} Points</span>
              </div>
            </div>
            
            <p>Thank you for your dedication to coastal protection, ${user.name}!</p>
            <p>Your contributions help keep communities safe.</p>
          </div>
        `;

        await this.sendEmail(
          user.email,
          `Major Achievement: ${achievement.name}`,
          htmlContent
        );
      }

      return true;
    } catch (error) {
      console.error('Achievement notification error:', error);
      return false;
    }
  }

  async sendDailySummaries() {
    try {
      const users = await User.find({
        'preferences.notifications.email': true,
        lastActive: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Active in last 7 days
      });

      const promises = users.map(user => this.sendDailySummary(user._id));
      await Promise.all(promises);

      console.log(`Daily summaries sent to ${users.length} users`);
      return true;
    } catch (error) {
      console.error('Daily summaries error:', error);
      return false;
    }
  }
}

module.exports = {
