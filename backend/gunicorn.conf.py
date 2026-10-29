import os

# Sized for a 512 MB instance: one process, with threads for concurrency, so the model and
# libraries are loaded once. Render provides PORT.
bind = f"0.0.0.0:{os.getenv('PORT', '10000')}"
workers = 1
worker_class = "gthread"
threads = 4
timeout = 60
accesslog = "-"
