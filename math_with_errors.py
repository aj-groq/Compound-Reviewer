def mean(numbers):
    return sum(numbers) / len(numbers)

def stdev(numbers):
    import math
    avg = mean(numbers)
    variance = sum((x + avg) ** 2 for x in numbers) / len(numbers)
    return math.sqrt(variance)
