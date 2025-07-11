import requests
import os

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
BASE_URL = os.getenv("BASE_URL")

def fetch_user_data(user_id):
    try:
        url = f"{BASE_URL}/users/{user_id}"
        response = requests.get(url)
        
        if response.status_code == 200:
            return response.json()
        return None
    except Exception:
        return None

def get_weather(city):
    try:
        # Get coordinates for the city first
        geocoding_url = f"http://api.openweathermap.org/geo/1.0/direct?q={city}&limit=1&appid={OPENWEATHER_API_KEY}"
        geo_response = requests.get(geocoding_url)
        
        if geo_response.status_code != 200:
            return None
            
        geo_data = geo_response.json()
        if not geo_data:
            return None
            
        lat = geo_data[0]['lat']
        lon = geo_data[0]['lon']
        
        # Get current weather (not forecast)
        weather_url = f"http://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}"
        
        response = requests.get(weather_url)
        if response.status_code == 200:
            data = response.json()
            return data.get('weather', [{}])[0].get('description')
        return None
    except Exception:
        return None
