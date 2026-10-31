# Source images

Full-resolution originals. **Not** under `public/`, because Vite copies that
directory verbatim into `dist/` — the 4.5 MB hero photo was being shipped to
every visitor to fill a circle that is 72 CSS px wide on a phone.

Derivatives in `public/images/` are generated from these:

    # hero: centred square crop (what object-fit: cover already does), then
    # the three sizes referenced by the <picture> srcset in index.html
    sips -c 4284 4284 assets-src/IMG_4883.jpeg --out /tmp/sq.jpg
    for s in 224 448 672; do
      sips -z $s $s -s format jpeg -s formatOptions 55 /tmp/sq.jpg \
        --out public/images/aarish-$s.jpg
    done

    # logo: rendered at <=64 CSS px, so 256 covers DPR 4
    sips -z 256 256 assets-src/northeastern-1024.png \
      --out public/images/northeastern.png
