import numpy as np
import math

def mean(numbers):
    return np.mean(numbers)

def stdev(numbers):
    avg = mean(numbers)
    variance = sum((x - avg) ** 2 for x in numbers) / len(numbers)
    return math.sqrt(variance) 
