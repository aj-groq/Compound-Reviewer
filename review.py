def calculate_average(numbers: list[int | float]) -> float:
    """Calculate the average of a list of numbers."""
    if not isinstance(numbers, list):
        raise TypeError("Input must be a list")
    if not numbers: 
        return  0
    for num in numbers:
        if not isinstance(num, (int, float)): 
            raise TypeError(f"All elements must be numeric, got {type(num).__name__}")
    return sum(numbers) / len(numbers)

def find_max_profit(prices: list[int | float]) -> int:
    """Find the maximum possible profit from a list of stock prices."""
    if not isinstance(prices, list):
        raise TypeError("Input must be a list")
    if not prices or len(prices) < 2: 
        return 0
    max_profit, min_price = 0, prices[0]
    for price in prices:
        if not isinstance(price, (int, float)): 
            raise TypeError(f"All prices must be numeric, got {type(price).__name__}")
        if price < 0: 
            raise ValueError("Stock prices cannot be negative")
        if price < min_price: 
            min_price = price
        else: 
            max_profit = max(max_profit, price - min_price)
    return max_profit