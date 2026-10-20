"""Render original PoleLine vector artwork. Requires Pillow 12.0.0."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
root = Path(__file__).resolve().parents[1]
ink = '#193052'
yellow = '#ffd457'
size = 2048
image = Image.new('RGB', (size, size), yellow)
draw = ImageDraw.Draw(image)
# An original toy circuit with a racing line and chequered starting flag.
def route(points, fill, width):
    pts = [(round(x*size/108), round(y*size/108)) for x,y in points]
    draw.line(pts, fill=fill, width=round(width*size/108), joint='curve')
    r=round(width*size/216)
    for x,y in pts: draw.ellipse((x-r,y-r,x+r,y+r),fill=fill)
route([(36,80),(28,72),(28,30),(36,24),(76,24),(82,31),(76,42),(53,42),(46,49),(46,72),(54,80),(76,80)],ink,18)
route([(36,80),(28,72),(28,30),(36,24),(76,24),(82,31),(76,42),(53,42),(46,49),(46,72),(54,80),(76,80)],'#f7f4e9',2)
for row in range(2):
    for col in range(4):
        x=(19+col*4)*size/108;y=(53+row*4)*size/108
        draw.rectangle((x,y,x+size*4/108,y+size*4/108),fill='white' if (row+col)%2 else ink)
draw.rounded_rectangle((size*22/108,size*65/108,size*34/108,size*74/108),radius=20,fill='#ed584d')
destination=root/'ios/PoleLine/Assets.xcassets/AppIcon.appiconset'
destination.mkdir(parents=True, exist_ok=True)
image.resize((1024,1024),Image.Resampling.LANCZOS).save(destination/'AppIcon.png')
(destination/'Contents.json').write_text(json.dumps({'images':[{'filename':'AppIcon.png','idiom':'universal','platform':'ios','size':'1024x1024'}],'info':{'author':'xcode','version':1}},indent=2))
(destination.parent/'Contents.json').write_text('{"info":{"author":"xcode","version":1}}')
background=destination.parent/'LaunchBackground.colorset'
background.mkdir(exist_ok=True)
(background/'Contents.json').write_text(json.dumps({'colors':[{'idiom':'universal','color':{'color-space':'srgb','components':{'red':'0.969','green':'0.957','blue':'0.914','alpha':'1.000'}}}],'info':{'author':'xcode','version':1}},indent=2))
store=root/'store/artwork'
store.mkdir(parents=True,exist_ok=True)
image.resize((512,512),Image.Resampling.LANCZOS).save(store/'icon-512.png')
feature=Image.new('RGB',(1024,500),'#f7f4e9')
feature.paste(image.resize((380,380),Image.Resampling.LANCZOS),(604,60))
text=ImageDraw.Draw(feature)
def font(size):
    for candidate in ['C:/Windows/Fonts/seguibl.ttf','/System/Library/Fonts/Supplemental/Arial Bold.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        if Path(candidate).exists(): return ImageFont.truetype(candidate,size)
    return ImageFont.load_default(size=size)
text.text((48,70),'TOYBOXES',font=font(24),fill=ink)
text.text((44,140),'PoleLine',font=font(96),fill=ink)
text.text((48,272),'Draw the lap.',font=font(32),fill=ink)
text.text((48,318),'Find your flow.',font=font(32),fill=ink)
text.text((48,408),'25 fictional circuits. Play offline.',font=font(22),fill=ink)
feature.save(store/'feature-1024x500.png')
print('Created original opaque store and iOS icons.')
