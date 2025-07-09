import math
from typing import List, Tuple

class MathReviewer:
    def __init__(self):
        self.reviews = []
    
    def add_review(self, score: float, weight: float = 1.0):
        """Add a review score with optional weight"""
        if 0 <= score <= 10:
            self.reviews.append((score, weight))
    
    def weighted_average(self) -> float:
        """Calculate weighted average of reviews"""
        if not self.reviews:
            return 0.0
        
        total_weighted = sum(score * weight for score, weight in self.reviews)
        total_weights = sum(weight for _, weight in self.reviews)
        return total_weighted / total_weights
    
    def standard_deviation(self) -> float:
        """Calculate standard deviation of review scores"""
        if len(self.reviews) < 2:
            return 0.0
        
        scores = [score for score, _ in self.reviews]
        mean = sum(scores) / len(scores)
        variance = sum((score - mean) ** 2 for score in scores) / len(scores)
        return math.sqrt(variance)
    
    def confidence_interval(self, confidence: float = 0.95) -> Tuple[float, float]:
        """Calculate confidence interval for the mean"""
        if len(self.reviews) < 2:
            return (0.0, 0.0)
        
        mean = self.weighted_average()
        std_dev = self.standard_deviation()
        n = len(self.reviews)
        
        # Using t-distribution approximation
        t_value = 1.96 if confidence == 0.95 else 2.576  # 99% confidence
        margin = t_value * (std_dev / math.sqrt(n))
        
        return (max(0, mean - margin), min(10, mean + margin))
    
    def percentile(self, p: float) -> float:
        """Calculate percentile of review scores"""
        if not self.reviews:
            return 0.0
        
        scores = sorted([score for score, _ in self.reviews])
        k = (len(scores) - 1) * (p / 100)
        f = math.floor(k)
        c = math.ceil(k)
        
        if f == c:
            return scores[int(k)]
        
        return scores[int(f)] * (c - k) + scores[int(c)] * (k - f)
    
    def summary(self) -> dict:
        """Get mathematical summary of reviews"""
        return {
            'count': len(self.reviews),
            'mean': round(self.weighted_average(), 2),
            'std_dev': round(self.standard_deviation(), 2),
            'median': round(self.percentile(50), 2),
            'q1': round(self.percentile(25), 2),
            'q3': round(self.percentile(75), 2),
            'confidence_95': tuple(round(x, 2) for x in self.confidence_interval())
        }

def demo():
    reviewer = MathReviewer()
    
    # Add sample reviews
    scores = [8.5, 7.2, 9.1, 6.8, 8.9, 7.5, 8.0, 9.3, 7.8, 8.2]
    for score in scores:
        reviewer.add_review(score)
    
    print("Review Analysis:")
    summary = reviewer.summary()
    for key, value in summary.items():
        print(f"  {key}: {value}")

if __name__ == '__main__':
    demo()