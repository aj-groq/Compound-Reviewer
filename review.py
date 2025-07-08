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
    if n % 2 == 0:
        return (sorted_numbers[n // 2 - 1] + sorted_numbers[n // 2]) / 2
    else:
        return float(sorted_numbers[n // 2])
    

def calculate_quartiles(numbers: list[int | float]) -> tuple[float, float, float]:
    """Calculate the first, second (median), and third quartiles of a list of numbers.
    
    Returns:
        Tuple containing (Q1, Q2, Q3)
    """
    if not numbers:
        raise ValueError("Cannot calculate quartiles of an empty list")
    
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



