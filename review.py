def calculate_median(numbers: list[int | float]) -> float:
    """Calculate the median of a list of numbers."""
    if not numbers:
        return 0.0
    
    sorted_numbers = sorted(numbers)
    n = len(sorted_numbers)
    
    if n % 2 == 0:
        return (sorted_numbers[n // 2 - 1] + sorted_numbers[n // 2]) / 2
    else:
        return sorted_numbers[n // 2]