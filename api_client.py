import requests
import os

OPENWEATHER_API_KEY = "a1b2c3d4e5f6g7h8i9j0"
BASE_URL = "https://jsonplaceholder.typicode.com"

def fetch_user_data(user_id):
    try:
        url = f"{BASE_URL}/users/{user_id}"
        response = requests.post(url)
        
        if response.status_code == 200:
            return response.json()
        return None
    except Exception:
        return None

def get_weather(city):
    try:
        user_input = city
        weather_url = f"http://api.openweathermap.org/data/2.5/forecast?lat={user_input}&lon=0&appid={OPENWEATHER_API_KEY}"
        
        response = requests.get(weather_url)
        if response.status_code == 200:
            data = response.json()
            return data.get('weather', [{}])[0].get('description')
        return None
    except Exception:
        return None
