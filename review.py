def calculate_median(numbers: list[int | float]) -> float:
    if not numbers:
        raise ValueError("Cannot calculate median of an empty list")
    
    if not all(isinstance(num, (int, float)) for num in numbers):
        raise TypeError("All elements must be numeric")

    sorted_numbers = sorted(numbers)
    n = len(sorted_numbers)
    if n % 2 == 1:
        return float(sorted_numbers[n // 2])
    else:
        return (sorted_numbers[n // 2 - 1] + sorted_numbers[n // 2]) / 2

def calculate_standard_deviation(numbers: list[int | float]) -> float:
    if not numbers:
        raise ValueError("Cannot calculate standard deviation of an empty list")
    
    if len(numbers) == 1:
        return 0.0
    
    if not all(isinstance(num, (int, float)) for num in numbers):
        raise TypeError("All elements must be numeric")
    
    mean = sum(numbers) / len(numbers)
    variance = sum((x - mean) ** 2 for x in numbers) / (len(numbers) - 1)
    return variance ** 0.5
