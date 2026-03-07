# Default Emoji Packs

Place emoji packs here organized by category:

```
default-emoji-packs/
  CategoryName/
    Pack Name/
      emoji_shortcode.png
      another_emoji.gif
      ...
```

- **Category** = top-level folder name
- **Pack name** = subfolder name
- **Shortcode** = image filename (without extension), lowercased, non-alphanumeric chars replaced with `_`
- **Supported formats**: `.png`, `.gif`, `.jpg`, `.jpeg`, `.webp`
- Images are processed to max 256x256, static images converted to WebP, animated GIFs kept as GIF
