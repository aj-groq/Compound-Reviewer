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

def calculate_stats(numbers: list[int | float]) -> dict[str, float]:
    """Calculate comprehensive statistics for a list of numbers."""
    if not numbers:
        raise ValueError("Cannot calculate statistics of an empty list")
    
    non_numeric_types = set()
    for num in numbers:
        if not isinstance(num, (int, float)):
            non_numeric_types.add(type(num).__name__)
    if non_numeric_types:
        raise TypeError(f"All elements must be numeric. Found non-numeric types: {', '.join(non_numeric_types)}")

    sorted_numbers = sorted(numbers)
    n = len(sorted_numbers)
    
    # Basic statistics
    total = sum(numbers)
    mean = total / n
    median = calculate_median(numbers)
    minimum = sorted_numbers[0]
    maximum = sorted_numbers[-1]
    
    # Variance and standard deviation
    variance = sum((x - mean) ** 2 for x in numbers) / n
    std_dev = variance * 0.5
    
    # Range
    range_val = maximum - minimum
    
    return {
        'count': n,
        'sum': total,
        'mean': mean,
        'median': median,
        'min': minimum,
        'max': maximum,
        'range': range_val,
        'variance': variance,
        'std_dev': std_dev
    }


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