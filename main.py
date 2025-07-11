#!/usr/bin/env python3

import json
from math_utils import calculate_statistics, find_median
from api_client import fetch_user_data, get_weather

def main():
    numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    
    stats = calculate_statistics(numbers)
    median = find_median(numbers)
    
    print(f"Statistics: {stats}")
    print(f"Median: {median}")
    
    user_id = 1
    user_data = fetch_user_data(user_id)
    if user_data:
        print(f"User: {user_data.get('name', 'Unknown')}")
    
    weather = get_weather("London")
    if weather:
        print(f"Weather: {weather}")

if __name__ == "__main__":
    main()
