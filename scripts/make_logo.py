from collections import deque
from pathlib import Path
from PIL import Image, ImageFilter

src = Path(r"C:\Users\geraldim.dias\projetaba\public\brand-mark.jpg")
im = Image.open(src).convert("RGBA")
width, height = im.size
pixels = im.load()
alpha = [[255] * width for _ in range(height)]

def is_backdrop(red, green, blue):
    maximum, minimum = max(red, green, blue), min(red, green, blue)
    sat = maximum - minimum
    if sat < 28 and maximum < 205:
        return True
    if maximum < 26 and sat < 18:
        return True
    gray = (red + green + blue) / 3
    if abs(red - gray) < 12 and abs(green - gray) < 12 and abs(blue - gray) < 12 and gray < 190:
        return True
    return False

queue = deque()
visited = [[False] * width for _ in range(height)]
for x in range(width):
    for y in (0, height - 1):
        queue.append((x, y))
        visited[y][x] = True
for y in range(height):
    for x in (0, width - 1):
        if not visited[y][x]:
            queue.append((x, y))
            visited[y][x] = True

while queue:
    x, y = queue.popleft()
    red, green, blue, _ = pixels[x, y]
    if not is_backdrop(red, green, blue):
        continue
    alpha[y][x] = 0
    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
        if 0 <= nx < width and 0 <= ny < height and not visited[ny][nx]:
            visited[ny][nx] = True
            queue.append((nx, ny))

for _ in range(6):
    changed = []
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            if alpha[y][x] == 0:
                continue
            red, green, blue, _ = pixels[x, y]
            maximum, minimum = max(red, green, blue), min(red, green, blue)
            sat = maximum - minimum
            empty = 0
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1), (x - 1, y - 1), (x + 1, y + 1), (x - 1, y + 1), (x + 1, y - 1)):
                if alpha[ny][nx] == 0:
                    empty += 1
            fringe = empty >= 3 and sat < 55 and maximum < 230
            if fringe:
                changed.append((x, y))
    if not changed:
        break
    for x, y in changed:
        alpha[y][x] = 0

out = Image.new("RGBA", (width, height))
dest = out.load()
for y in range(height):
    for x in range(width):
        red, green, blue, _ = pixels[x, y]
        dest[x, y] = (red, green, blue, alpha[y][x])

out = out.filter(ImageFilter.UnsharpMask(radius=1, percent=80, threshold=3))
bbox = out.getbbox()
pad = 8
x0, y0, x1, y1 = bbox
x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
x1, y1 = min(width, x1 + pad), min(height, y1 + pad)
logo = out.crop((x0, y0, x1, y1))
logo.save(Path(r"C:\Users\geraldim.dias\projetaba\public\brand-logo.png"))
ly1 = y0 + int((y1 - y0) * 0.56)
lion = out.crop((x0, y0, x1, ly1))
lb = lion.getbbox()
if lb:
    lion = lion.crop(lb)
lion.save(Path(r"C:\Users\geraldim.dias\projetaba\public\brand-mark.png"))
print("logo", logo.size, "mark", lion.size, "opaque", sum(1 for y in range(height) for x in range(width) if alpha[y][x]))
