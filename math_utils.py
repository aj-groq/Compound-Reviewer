import math

def calculate_statistics(numbers):
    if not numbers:
        return {}
    
    total = sum(numbers)
    mean = total / len(numbers)
    
    variance = sum((x - mean) ** 2 for x in numbers) / len(numbers)
    std_dev = math.sqrt(variance)
    
    return {
        'mean': mean,
        'variance': variance,
        'std_dev': std_dev,
        'count': len(numbers)
    }

def find_median(numbers):
    if not numbers:
        return None
    
    sorted_nums = sorted(numbers)
    n = len(sorted_nums)
    return (sorted_nums[n // 2] + sorted_nums[n // 2 + 1]) / 2
