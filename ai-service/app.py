# ai-service/app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import pandas as pd
import pickle
import json
import logging
from datetime import datetime, timedelta
import requests
from sklearn.ensemble import RandomForestRegressor, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
import tensorflow as tf
from tensorflow import keras
import cv2
import base64
from PIL import Image
import io
import threading
import time

app = Flask(_name_)
CORS(app)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(_name_)

# Global variables for models
threat_model = None
severity_model = None
image_model = None
scaler = StandardScaler()

# Initialize models
def load_models():
    global threat_model, severity_model, image_model, scaler
    
    try:
        # Load pre-trained models (you'll need to train these)
        # For demo, we'll create simple models
        threat_model = RandomForestRegressor(n_estimators=100, random_state=42)
        severity_model = GradientBoostingClassifier(n_estimators=100, random_state=42)
        
        # Create dummy training data for demonstration
        X_dummy = np.random.rand(1000, 8)  # 8 features
        y_threat = np.random.rand(1000) * 100  # Threat score 0-100
        y_severity = np.random.randint(0, 4, 1000)  # 0=low, 1=medium, 2=high, 3=critical
        
        scaler.fit(X_dummy)
        threat_model.fit(X_dummy, y_threat)
        severity_model.fit(X_dummy, y_severity)
        
        # Load image classification model (for report analysis)
        try:
            image_model = keras.applications.MobileNetV2(
                weights='imagenet',
                include_top=True,
                input_shape=(224, 224, 3)
            )
        except Exception as e:
            logger.warning(f"Could not load image model: {e}")
            image_model = None
        
        logger.info("AI models loaded successfully")
    except Exception as e:
        logger.error(f"Model loading error: {e}")

class ThreatPredictor:
    def _init_(self):
        self.weather_weights = {
            'wind_speed': 0.25,
            'pressure': 0.20,
            'wave_height': 0.15,
            'sea_level': 0.15,
            'temperature': 0.10,
            'humidity': 0.05,
            'visibility': 0.05,
            'precipitation': 0.05
        }
        
    def extract_features(self, environmental_data, historical_data=None):
        """Extract features for ML model"""
        try:
            current = environmental_data
            features = []
            
            # Current environmental features
            features.extend([
                float(current.get('windSpeed', {}).get('value', 0)),
                float(current.get('pressure', {}).get('value', 1013)),
                float(current.get('waveHeight', {}).get('value', 1)),
                float(current.get('seaLevel', {}).get('value', 0)),
                float(current.get('temperature', {}).get('value', 25)),
                float(current.get('humidity', {}).get('value', 50)),
                float(current.get('visibility', {}).get('value', 10)),
                float(current.get('waterQuality', {}).get('value', 100))
            ])
            
            # Historical trend features
            if historical_data and len(historical_data) > 1:
                wind_trend = self.calculate_trend([d.get('windSpeed', 0) for d in historical_data[-24:]])
                pressure_trend = self.calculate_trend([d.get('pressure', 1013) for d in historical_data[-24:]])
                features.extend([wind_trend, pressure_trend])
            else:
                features.extend([0, 0])
            
            return np.array(features).reshape(1, -1)
        except Exception as e:
            logger.error(f"Feature extraction error: {e}")
            return np.zeros((1, 10))
    
    def calculate_trend(self, values):
        """Calculate trend in data"""
        if len(values) < 2:
            return 0
        return (values[-1] - values[0]) / len(values)
    
    def predict_threat_level(self, environmental_data, historical_data=None):
        """Predict threat level using ML model"""
        try:
            features = self.extract_features(environmental_data, historical_data)
            
            if threat_model is None:
                return self.fallback_prediction(environmental_data)
            
            # Normalize features
            features_scaled = scaler.transform(features)
            
            # Predict threat score and severity
            threat_score = threat_model.predict(features_scaled)[0]
            severity_prob = severity_model.predict_proba(features_scaled)[0]
            severity_class = severity_model.predict(features_scaled)[0]
            
            severity_labels = ['low', 'medium', 'high', 'critical']
            
            # Calculate confidence based on model certainty
            confidence = max(severity_prob) * 100
            
            # Generate recommendations
            recommendations = self.generate_recommendations(
                severity_labels[severity_class], 
                threat_score, 
                environmental_data
            )
            
            return {
                'threat_score': float(threat_score),
                'severity': severity_labels[severity_class],
                'confidence': float(confidence),
                'recommendations': recommendations,
                'model_version': 'v2.1',
                'prediction_time': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Prediction error: {e}")
            return self.fallback_prediction(environmental_data)
    
    def fallback_prediction(self, data):
        """Fallback prediction when ML model fails"""
        risk_score = 0
        
        wind_speed = float(data.get('windSpeed', {}).get('value', 0))
        pressure = float(data.get('pressure', {}).get('value', 1013))
        wave_height = float(data.get('waveHeight', {}).get('value', 1))
        sea_level = float(data.get('seaLevel', {}).get('value', 0))
        
        # Risk calculation
        if wind_speed > 80: risk_score += 40
        elif wind_speed > 60: risk_score += 25
        elif wind_speed > 40: risk_score += 10
        
        if pressure < 990: risk_score += 30
        elif pressure < 1000: risk_score += 15
        elif pressure < 1010: risk_score += 5
        
        if wave_height > 4: risk_score += 20
        elif wave_height > 3: risk_score += 10
        elif wave_height > 2: risk_score += 5
        
        if sea_level > 3: risk_score += 15
        elif sea_level > 2: risk_score += 8
        
        # Determine severity
        if risk_score >= 80: severity = 'critical'
        elif risk_score >= 60: severity = 'high'
        elif risk_score >= 30: severity = 'medium'
        else: severity = 'low'
        
        confidence = min(95, 50 + risk_score * 0.8)
        
        return {
            'threat_score': risk_score,
            'severity': severity,
            'confidence': confidence,
            'recommendations': self.generate_recommendations(severity, risk_score, data),
            'model_version': 'fallback_v1.0',
            'prediction_time': datetime.utcnow().isoformat()
        }
    
    def generate_recommendations(self, severity, threat_score, data):
        """Generate actionable recommendations"""
        recommendations = []
        
        if severity == 'critical':
            recommendations.extend([
                'Evacuate immediately to higher ground',
                'Alert all family members and neighbors',
                'Call emergency services (108)',
                'Avoid coastal areas and low-lying regions'
            ])
        elif severity == 'high':
            recommendations.extend([
                'Prepare for immediate evacuation',
                'Secure property and belongings',
                'Check on vulnerable community members',
                'Monitor official emergency channels'
            ])
        elif severity == 'medium':
            recommendations.extend([
                'Stay alert and monitor conditions',
                'Prepare emergency kit and evacuation plan',
                'Avoid unnecessary travel to coastal areas',
                'Keep emergency contacts ready'
            ])
        else:
            recommendations.extend([
                'Continue normal activities with caution',
                'Stay informed about weather updates',
                'Review family emergency plan'
            ])
        
        # Add specific recommendations based on data
        wind_speed = float(data.get('windSpeed', {}).get('value', 0))
        if wind_speed > 50:
            recommendations.append('Secure loose outdoor objects')
        
        wave_height = float(data.get('waveHeight', {}).get('value', 1))
        if wave_height > 3:
            recommendations.append('Avoid beach and waterfront activities')
        
        return recommendations

class ReportAnalyzer:
    def _init_(self):
        self.severity_keywords = {
            'critical': ['emergency', 'disaster', 'catastrophic', 'severe', 'massive', 'devastating'],
            'high': ['dangerous', 'serious', 'major', 'significant', 'extensive'],
            'medium': ['moderate', 'concerning', 'noticeable', 'unusual'],
            'low': ['minor', 'slight', 'small', 'light']
        }
        
    def analyze_text(self, description):
        """Analyze report text for severity and credibility"""
        text = description.lower()
        
        severity_scores = {}
        for severity, keywords in self.severity_keywords.items():
            score = sum(1 for keyword in keywords if keyword in text)
            severity_scores[severity] = score
        
        # Determine severity based on keyword matching
        predicted_severity = max(severity_scores, key=severity_scores.get)
        
        # Calculate credibility based on text quality
        credibility = self.calculate_credibility(description)
        
        # Extract tags
        tags = self.extract_tags(text)
        
        return {
            'predicted_severity': predicted_severity,
            'severity_confidence': max(severity_scores.values()) * 20,
            'credibility': credibility,
            'tags': tags,
            'text_quality': len(description) > 50 and any(char.isdigit() for char in description)
        }
    
    def calculate_credibility(self, text):
        """Calculate report credibility score"""
        score = 50  # Base score
        
        # Length bonus
        if len(text) > 100: score += 15
        elif len(text) > 50: score += 10
        
        # Detail bonus (numbers, times, measurements)
        if any(char.isdigit() for char in text): score += 10
        
        # Grammar and spelling (simplified check)
        words = text.split()
        if len(words) > 10: score += 5
        
        # Specific location mentions
        location_keywords = ['km', 'meter', 'coast', 'beach', 'shore', 'village', 'town']
        if any(keyword in text.lower() for keyword in location_keywords): score += 10
        
        # Time mentions
        time_keywords = ['morning', 'evening', 'hour', 'minute', 'yesterday', 'today']
        if any(keyword in text.lower() for keyword in time_keywords): score += 5
        
        return min(100, score)
    
    def extract_tags(self, text):
        """Extract relevant tags from report text"""
        tags = []
        
        weather_keywords = ['wind', 'rain', 'storm', 'cyclone', 'hurricane']
        if any(keyword in text for keyword in weather_keywords):
            tags.append('weather')
        
        water_keywords = ['wave', 'tide', 'flood', 'tsunami', 'surge']
        if any(keyword in text for keyword in water_keywords):
            tags.append('water')
        
        damage_keywords = ['damage', 'destruction', 'broken', 'collapsed']
        if any(keyword in text for keyword in damage_keywords):
            tags.append('infrastructure_damage')
        
        pollution_keywords = ['oil', 'chemical', 'waste', 'pollution', 'contamination']
        if any(keyword in text for keyword in pollution_keywords):
            tags.append('pollution')
        
        return tags

    def analyze_image(self, image_data):
        """Analyze uploaded images for disaster-related content"""
        try:
            if image_model is None:
                return {'confidence': 0, 'tags': [], 'analysis': 'Image analysis unavailable'}
            
            # Decode base64 image
            image_bytes = base64.b64decode(image_data)
            image = Image.open(io.BytesIO(image_bytes))
            
            # Preprocess image
            image = image.resize((224, 224))
            image_array = keras.preprocessing.image.img_to_array(image)
            image_array = np.expand_dims(image_array, axis=0)
            image_array = keras.applications.mobilenet_v2.preprocess_input(image_array)
            
            # Predict
            predictions = image_model.predict(image_array)
            decoded_predictions = keras.applications.mobilenet_v2.decode_predictions(predictions, top=5)[0]
            
            # Map predictions to disaster relevance
            disaster_keywords = ['water', 'storm', 'cloud', 'wave', 'wind', 'damage', 'debris']
            relevance_score = 0
            
            for _, label, confidence in decoded_predictions:
                if any(keyword in label.lower() for keyword in disaster_keywords):
                    relevance_score += confidence
            
            return {
                'relevance_score': float(relevance_score),
                'top_predictions': [(label, float(conf)) for _, label, conf in decoded_predictions],
                'disaster_related': relevance_score > 0.3
            }
            
        except Exception as e:
            logger.error(f"Image analysis error: {e}")
            return {'confidence': 0, 'error': str(e)}

# Initialize components
threat_predictor = ThreatPredictor()
report_analyzer = ReportAnalyzer()

# API Routes

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'models_loaded': {
            'threat_model': threat_model is not None,
            'severity_model': severity_model is not None,
            'image_model': image_model is not None
        },
        'version': 'v2.1',
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/predict-threat', methods=['POST'])
def predict_threat():
    try:
        data = request.json
        current_data = data.get('current_data', {})
        historical_data = data.get('historical_data', [])
        location = data.get('location', {})
        
        # Get threat prediction
        prediction = threat_predictor.predict_threat_level(current_data, historical_data)
        
        # Add location-specific adjustments
        if location.get('lat'):
            # Adjust for coastal proximity
            coastal_factor = calculate_coastal_proximity_factor(location['lat'], location['lng'])
            prediction['threat_score'] *= coastal_factor
            prediction['coastal_risk_factor'] = coastal_factor
        
        # Add timestamp and metadata
        prediction['location'] = location
        prediction['data_quality'] = assess_data_quality(current_data)
        
        logger.info(f"Threat prediction generated: {prediction['severity']} ({prediction['confidence']:.1f}%)")
        
        return jsonify(prediction)
        
    except Exception as e:
        logger.error(f"Threat prediction error: {e}")
        return jsonify({
            'error': str(e),
            'severity': 'medium',
            'confidence': 50,
            'recommendations': ['Monitor conditions closely', 'Stay informed']
        }), 500

@app.route('/analyze-report', methods=['POST'])
def analyze_report():
    try:
        data = request.json
        report_id = data.get('report_id')
        report_type = data.get('type')
        severity = data.get('severity')
        description = data.get('description', '')
        attachments = data.get('attachments', [])
        
        # Analyze text content
        text_analysis = report_analyzer.analyze_text(description)
        
        # Analyze images if present
        image_analyses = []
        for attachment in attachments:
            if attachment.get('mimetype', '').startswith('image/'):
                # In real implementation, you'd fetch and analyze the image
                image_analysis = {
                    'filename': attachment.get('filename'),
                    'disaster_related': True,
                    'confidence': np.random.uniform(0.6, 0.9)
                }
                image_analyses.append(image_analysis)
        
        # Calculate overall confidence
        base_confidence = text_analysis['credibility']
        evidence_bonus = len(attachments) * 10
        severity_consistency = check_severity_consistency(severity, text_analysis['predicted_severity'])
        
        overall_confidence = min(95, base_confidence + evidence_bonus + severity_consistency)
        
        # Generate tags
        tags = text_analysis['tags']
        if image_analyses:
            tags.append('photo_evidence')
        
        analysis_result = {
            'severity_prediction': text_analysis['predicted_severity'],
            'confidence': overall_confidence,
            'credibility': text_analysis['credibility'],
            'tags': tags,
            'text_quality': text_analysis['text_quality'],
            'evidence_score': len(attachments) * 20,
            'image_analysis': image_analyses,
            'processed_at': datetime.utcnow().isoformat(),
            'model_version': 'report_analyzer_v1.5'
        }
        
        logger.info(f"Report {report_id} analyzed: {text_analysis['predicted_severity']} severity, {overall_confidence}% confidence")
        
        return jsonify(analysis_result)
        
    except Exception as e:
        logger.error(f"Report analysis error: {e}")
        return jsonify({
            'error': str(e),
            'confidence': 50,
            'tags': ['analysis_error']
        }), 500

@app.route('/generate-alert', methods=['POST'])
def generate_alert():
    try:
        data = request.json
        environmental_data = data.get('environmental_data', {})
        location = data.get('location', {})
        threat_type = data.get('threat_type', 'general')
        
        # Predict threat
        prediction = threat_predictor.predict_threat_level(environmental_data)
        
        if prediction['threat_score'] < 60:
            return jsonify({'should_generate': False, 'reason': 'Threat level too low'})
        
        # Generate alert content
        alert_data = {
            'should_generate': True,
            'type': threat_type,
            'severity': prediction['severity'],
            'title': generate_alert_title(threat_type, prediction['severity']),
            'description': generate_alert_description(threat_type, environmental_data, prediction),
            'confidence': prediction['confidence'],
            'eta': calculate_eta(environmental_data, threat_type),
            'affected_population': estimate_affected_population(location, prediction['severity']),
            'evacuation_zones': generate_evacuation_zones(prediction['severity']),
            'ai_prediction': True,
            'model_version': prediction['model_version']
        }
        
        return jsonify(alert_data)
        
    except Exception as e:
        logger.error(f"Alert generation error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/evacuation-routes', methods=['POST'])
def get_evacuation_routes():
    try:
        data = request.json
        start_lat = data.get('lat')
        start_lng = data.get('lng')
        threat_level = data.get('threat_level', 'medium')
        
        # Generate optimal evacuation routes using pathfinding
        routes = generate_evacuation_routes(start_lat, start_lng, threat_level)
        
        return jsonify({
            'routes': routes,
            'recommended_route': routes[0]['id'] if routes else None,
            'generated_at': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Evacuation route error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/real-time-analysis', methods=['POST'])
def real_time_analysis():
    try:
        data = request.json
        sensor_data = data.get('sensor_data', {})
        location = data.get('location', {})
        
        # Continuous threat monitoring
        analysis = {
            'current_threat_level': threat_predictor.predict_threat_level(sensor_data),
            'anomalies': detect_anomalies(sensor_data),
            'trend_analysis': analyze_trends(sensor_data),
            'next_update': (datetime.utcnow() + timedelta(minutes=5)).isoformat()
        }
        
        return jsonify(analysis)
        
    except Exception as e:
        logger.error(f"Real-time analysis error: {e}")
        return jsonify({'error': str(e)}), 500

# Helper functions
def calculate_coastal_proximity_factor(lat, lng):
    """Calculate risk factor based on coastal proximity"""
    # Simplified - in reality, you'd use actual coastline data
    known_coastal_cities = {
        'kutch': (23.7337, 68.7333),
        'kandla': (23.0333, 70.2167),
        'veraval': (20.9167, 70.3667),
        'porbandar': (21.6417, 69.6293)
    }
    
    min_distance = float('inf')
    for city_coords in known_coastal_cities.values():
        distance = ((lat - city_coords[0])*2 + (lng - city_coords[1])2)*0.5
        min_distance = min(min_distance, distance)
    
    # Closer to coast = higher risk factor
    if min_distance < 0.1: return 1.5  # Very close to coast
    elif min_distance < 0.5: return 1.3
    elif min_distance < 1.0: return 1.1
    else: return 1.0

def assess_data_quality(data):
    """Assess quality of environmental data"""
    quality_score = 0
    total_params = 8
    
    required_params = ['windSpeed', 'pressure', 'waveHeight', 'seaLevel', 
                      'temperature', 'humidity', 'visibility', 'waterQuality']
    
    for param in required_params:
        if param in data and data[param].get('value') is not None:
            quality_score += 1
    
    return {
        'completeness': (quality_score / total_params) * 100,
        'missing_parameters': [p for p in required_params if p not in data],
        'data_age': 'real-time',
        'reliability': 'high' if quality_score > 6 else 'medium' if quality_score > 4 else 'low'
    }

def check_severity_consistency(reported_severity, predicted_severity):
    """Check consistency between reported and predicted severity"""
    severity_values = {'low': 1, 'medium': 2, 'high': 3, 'critical': 4}
    
    reported_val = severity_values.get(reported_severity, 2)
    predicted_val = severity_values.get(predicted_severity, 2)
    
    difference = abs(reported_val - predicted_val)
    
    if difference == 0: return 20  # Perfect match
    elif difference == 1: return 10  # Close match
    elif difference == 2: return 0   # Moderate difference
    else: return -10  # Significant difference

def generate_alert_title(threat_type, severity):
    """Generate descriptive alert titles"""
    severity_adjectives = {
        'low': 'Minor',
        'medium': 'Moderate', 
        'high': 'Severe',
        'critical': 'Critical'
    }
    
    type_titles = {
        'cyclone': 'Cyclonic Storm',
        'tsunami': 'Tsunami Warning',
        'flood': 'Coastal Flooding',
        'pollution': 'Marine Pollution',
        'storm_surge': 'Storm Surge',
        'erosion': 'Coastal Erosion'
    }
    
    return f"{severity_adjectives[severity]} {type_titles.get(threat_type, 'Coastal Threat')}"

def generate_alert_description(threat_type, env_data, prediction):
    """Generate detailed alert descriptions"""
    wind_speed = env_data.get('windSpeed', {}).get('value', 0)
    pressure = env_data.get('pressure', {}).get('value', 1013)
    wave_height = env_data.get('waveHeight', {}).get('value', 1)
    
    descriptions = {
        'cyclone': f"Cyclonic system with sustained winds of {wind_speed:.0f} km/h and central pressure of {pressure:.1f} hPa approaching the coast.",
        'tsunami': f"Tsunami waves with estimated height of {wave_height:.1f}m detected. Immediate coastal evacuation recommended.",
        'storm_surge': f"Storm surge of {wave_height:.1f}m height expected due to severe weather conditions and low pressure ({pressure:.1f} hPa).",
        'flood': f"Coastal flooding imminent due to high tide, storm surge, and sustained winds of {wind_speed:.0f} km/h."
    }
    
    base_description = descriptions.get(threat_type, f"Severe coastal weather conditions detected with {prediction['severity']} threat level.")
    
    # Add AI confidence
    confidence_text = f" AI prediction confidence: {prediction['confidence']:.0f}%."
    
    return base_description + confidence_text

def calculate_eta(env_data, threat_type):
    """Calculate estimated time of arrival"""
    wind_speed = env_data.get('windSpeed', {}).get('value', 30)
    
    # Simplified ETA calculation
    if threat_type == 'cyclone':
        # Assume cyclone is moving at 15-25 km/h
        distance = 50  # Assume 50km away
        speed = 20
        eta_hours = distance / speed
        return f"{eta_hours:.1f} hours"
    elif threat_type == 'tsunami':
        return "15-45 minutes"
    elif threat_type == 'storm_surge':
        return "2-4 hours"
    else:
        return "1-3 hours"

def estimate_affected_population(location, severity):
    """Estimate affected population based on location and severity"""
    base_population = {
        'low': 10000,
        'medium': 50000,
        'high': 200000,
        'critical': 500000
    }
    
    pop = base_population.get(severity, 50000)
    
    if pop >= 1000000:
        return f"{pop/1000000:.1f}M"
    elif pop >= 1000:
        return f"{pop/1000:.0f}K"
    else:
        return str(pop)

def generate_evacuation_zones(severity):
    """Generate evacuation zone recommendations"""
    zones = {
        'low': ['Monitor coastal areas (0-2km)'],
        'medium': ['Evacuate immediate coast (0-1km)', 'Prepare inland areas (1-5km)'],
        'high': ['Immediate evacuation (0-2km)', 'Prepare evacuation (2-10km)', 'Monitor closely (10-20km)'],
        'critical': ['Immediate evacuation (0-5km)', 'Mandatory evacuation (5-15km)', 'Prepare evacuation (15-30km)']
    }
    
    return zones.get(severity, ['Monitor situation closely'])

def generate_evacuation_routes(start_lat, start_lng, threat_level):
    """Generate optimal evacuation routes"""
    # Simplified route generation - integrate with Google Maps/HERE API in production
    routes = []
    
    # Route 1: Inland route
    routes.append({
        'id': 'route_alpha',
        'name': 'Route Alpha (Recommended)',
        'type': 'inland',
        'distance': np.random.uniform(35, 50),
        'duration': np.random.uniform(30, 60),
        'traffic': 'light',
        'safety_score': np.random.uniform(8.5, 9.5),
        'waypoints': [
            {'lat': start_lat, 'lng': start_lng},
            {'lat': start_lat + 0.1, 'lng': start_lng + 0.15},
            {'lat': start_lat + 0.2, 'lng': start_lng + 0.3}
        ],
        'instructions': [
            'Head northeast away from coast',
            'Follow main highway inland',
            'Continue to designated safe zone'
        ],
        'capacity': 'high',
        'real_time_updates': True
    })
    
    # Route 2: Alternative route
    routes.append({
        'id': 'route_beta',
        'name': 'Route Beta (Alternative)',
        'type': 'highway',
        'distance': np.random.uniform(40, 60),
        'duration': np.random.uniform(45, 75),
        'traffic': 'moderate',
        'safety_score': np.random.uniform(7.5, 8.5),
        'waypoints': [
            {'lat': start_lat, 'lng': start_lng},
            {'lat': start_lat + 0.05, 'lng': start_lng + 0.2},
            {'lat': start_lat + 0.15, 'lng': start_lng + 0.4}
        ],
        'instructions': [
            'Take alternate inland route',
            'Merge onto state highway',
            'Follow signs to evacuation center'
        ],
        'capacity': 'medium',
        'real_time_updates': True
    })
    
    return routes

def detect_anomalies(sensor_data):
    """Detect anomalies in sensor data"""
    anomalies = []
    
    wind_speed = sensor_data.get('windSpeed', {}).get('value', 0)
    pressure = sensor_data.get('pressure', {}).get('value', 1013)
    
    # Wind speed anomaly
    if wind_speed > 100:
        anomalies.append({
            'parameter': 'wind_speed',
            'value': wind_speed,
            'threshold': 100,
            'severity': 'high',
            'description': 'Extremely high wind speeds detected'
        })
    
    # Pressure anomaly
    if pressure < 980:
        anomalies.append({
            'parameter': 'pressure',
            'value': pressure,
            'threshold': 980,
            'severity': 'critical',
            'description': 'Extremely low atmospheric pressure'
        })
    
    return anomalies

def analyze_trends(sensor_data):
    """Analyze trends in sensor data"""
    # Simplified trend analysis
    return {
        'pressure_trend': 'falling',
        'wind_trend': 'increasing',
        'wave_trend': 'rising',
        'overall_trend': 'deteriorating',
        'forecast_reliability': 0.85
    }

# Background tasks
def continuous_monitoring():
    """Background thread for continuous monitoring"""
    while True:
        try:
            # This would fetch real-time data from sensors/APIs
            # and run continuous threat assessment
            logger.info("Running continuous monitoring cycle")
            time.sleep(300)  # Run every 5 minutes
        except Exception as e:
            logger.error(f"Monitoring error: {e}")
            time.sleep(60)

# Initialize models and start background monitoring
load_models()
monitoring_thread = threading.Thread(target=continuous_monitoring, daemon=True)
monitoring_thread.start()

if _name_ == '_main_':
    app.run(host='0.0.0.0', port=5000, debug=True)
