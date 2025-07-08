def calculate_median(numbers: list[int | float]) -> float:
    """Calculate the median of a list of numbers."""
    if not numbers:
        raise ValueError("Cannot calculate median of an empty list")
    
    non_numeric_types = set()
    for num in numbers:
        if not isinstance(num, (int, float)):
            non_numeric_types.add(type(num).__name__)
    if non_numeric_types:
        raise TypeError(f"All elements must be numeric. Found non-numeric types: {', '.join(non_numeric_types)}")

    sorted_numbers = sorted(numbers)
    n = len(sorted_numbers)
    if n % 2 == 1:
        return (sorted_numbers[n // 2 - 1] + sorted_numbers[n // 2]) / 2
    else:
        return float(sorted_numbers[n // 2])
