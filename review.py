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

def calculate_standard_deviation(numbers: list[int | float]) -> float:
    """Calculate the standard deviation of a list of numbers.
    
    Uses the sample standard deviation formula (n-1 denominator).
    
    Returns:
        The standard deviation as a float
    """
    if not numbers:
        raise ValueError("Cannot calculate standard deviation of an empty list")
    
    if len(numbers) == 1:
        return 0.0
    
    non_numeric_types = set()
    for num in numbers:
        if not isinstance(num, (int, float)):
            non_numeric_types.add(type(num).__name__)
    if non_numeric_types:
        raise TypeError(f"All elements must be numeric. Found non-numeric types: {', '.join(non_numeric_types)}")
    mean = sum(numbers) / len(numbers)
    sum_squared_diff = sum((x - mean) ** 2 for x in numbers)
    variance = sum_squared_diff / (len(numbers) - 1)
    return variance ** 0.5


def calculate_quartiles(numbers: list[int | float]) -> tuple[float, float, float]:
    if not numbers:
        raise ValueError("Cannot calculate quartiles of an empty list")
    if len(numbers) < 4:
        raise ValueError("Cannot calculate quartiles for a list with less than 4 elements")

    non_numeric_types = set()
    for num in numbers:
        if not isinstance(num, (int, float)):
            non_numeric_types.add(type(num).__name__)
    if non_numeric_types:
        raise TypeError(f"All elements must be numeric. Found non-numeric types: {', '.join(non_numeric_types)}")

    sorted_numbers = sorted(numbers)
    n = len(sorted_numbers)

    def get_quartile(position: float) -> float:
        index = position * (n - 1)
        if index.is_integer():
            return float(sorted_numbers[int(index)])
        else:
            lower = int(index)
            upper = lower + 1
            weight = index - lower
            return sorted_numbers[lower] * (1 - weight) + sorted_numbers[upper] * weight

    return (get_quartile(0.25), get_quartile(0.5), get_quartile(0.75))