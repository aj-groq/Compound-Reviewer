import requests
import os

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
BASE_URL = os.getenv("BASE_URL")

def fetch_user_data(user_id):
    """Fetch user data from API."""
    if not BASE_URL:
        return None
    
    try:
        url = f"{BASE_URL}/users/{user_id}"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError):
        return None

def get_weather(city):
    """Get weather description for a city."""
    if not OPENWEATHER_API_KEY or not city:
        return None
    
    try:
        # Use direct weather API with city name (simpler approach)
        weather_url = f"http://api.openweathermap.org/data/2.5/weather?q={city}&appid={OPENWEATHER_API_KEY}"
        response = requests.get(weather_url, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        weather_list = data.get('weather', [])
        if weather_list:
            return weather_list[0].get('description')
        return None
    except (requests.RequestException, ValueError, KeyError, IndexError):
        return None
