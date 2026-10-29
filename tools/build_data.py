"""Single source of truth for the Japan list.

Run:  python tools/build_data.py
Writes: site/places.js, exports/japan-places.kml, exports/japan-places.csv
"""
import csv, json, pathlib, re
from xml.sax.saxutils import escape

ROOT = pathlib.Path(__file__).resolve().parent.parent

CATEGORIES = {
    "yokai":     {"label": "Yokai & Folklore",            "color": "#7c3aed", "icon": "👹"},
    "weird":     {"label": "Weird & Quirky",              "color": "#db2777", "icon": "🌀"},
    "history":   {"label": "History & Memorials",         "color": "#b45309", "icon": "🏯"},
    "museum":    {"label": "Museums & Collections",       "color": "#0369a1", "icon": "🏛️"},
    "art":       {"label": "Art & Galleries",             "color": "#0d9488", "icon": "🎨"},
    "nature":    {"label": "Nature, Animals & Islands",   "color": "#16a34a", "icon": "🌿"},
    "abandoned": {"label": "Abandoned & Ruins",           "color": "#57534e", "icon": "🏚️"},
    "spiritual": {"label": "Temples & Shrines",           "color": "#dc2626", "icon": "⛩️"},
    "fun":       {"label": "Theme Parks & Entertainment", "color": "#ea580c", "icon": "🎢"},
    "relax":     {"label": "Onsen & Spa",                 "color": "#0891b2", "icon": "♨️"},
    "shopping":  {"label": "Shopping & Pop Culture",      "color": "#ca8a04", "icon": "🛍️"},
    "food":      {"label": "Food & Drink",                "color": "#65a30d", "icon": "🍣"},
}

# (name, city, prefecture, lat, lng, category, note, source, approx)
# source: "doc-link" | "doc-text" | "doc-image" | "added"
# approx=True -> pin is area-level; drag it to the exact spot in the app.
P = [
    # --- From the document (links + text) ---
    ("Chaos Room", "Kyoto", "Kyoto", 35.0116, 135.7681, "weird", "One-room museum crammed with an overwhelming array of art and objects.", "doc-link", True),
    ("Abandoned Western Village", "Nikko", "Tochigi", 36.7560, 139.7040, "abandoned", "Derelict Wild-West theme park full of decaying animatronic cowboys. Check access rules; don't trespass.", "doc-link", True),
    ("Yokai Yashiki (Monster & Stone Museum)", "Miyoshi (Iya Valley)", "Tokushima", 33.8746, 133.7685, "yokai", "Folk monsters of the Iya Valley plus the region's unique geology, at Michi-no-Eki Oboke.", "doc-link", False),
    ("Ashizuri Underwater Observation Tower", "Tosashimizu", "Kochi", 32.7835, 132.8640, "nature", "Tower that lets you walk down below the waves to watch coral and fish.", "doc-link", False),
    ("Dainichibo Temple (Sokushinbutsu)", "Tsuruoka", "Yamagata", 38.5806, 139.8890, "spiritual", "Temple housing a self-mummified Buddhist monk.", "doc-link", False),
    ("Ryusendo Cave", "Iwaizumi", "Iwate", 39.8497, 141.7950, "nature", "Limestone cave with some of the clearest underground lakes in the world.", "doc-link", False),
    ("Okunoshima (Rabbit Island)", "Takehara", "Hiroshima", 34.3087, 132.9946, "nature", "Island overrun by friendly rabbits; also a WWII poison-gas museum.", "doc-link", False),
    ("Sogenji (Kappa-dera Temple)", "Asakusa, Tokyo", "Tokyo", 35.7148, 139.7880, "yokai", "Temple dedicated to the kappa, with a mummified kappa hand.", "doc-link", False),
    ("Gunkanjima (Hashima Island)", "Nagasaki", "Nagasaki", 32.6277, 129.7385, "abandoned", "Abandoned coal-mining island city; visit by boat tour.", "doc-link", False),
    ("Akihabara Electric Town", "Tokyo", "Tokyo", 35.6984, 139.7731, "shopping", "Electronics, anime, manga and retro games.", "doc-link", False),
    ("Yokai Street (Ichijo-dori)", "Kyoto", "Kyoto", 35.0258, 135.7420, "yokai", "Shopping street lined with handmade yokai figures.", "doc-link", False),
    ("Sanrio Puroland", "Tama, Tokyo", "Tokyo", 35.6247, 139.4285, "fun", "Indoor Hello Kitty theme park.", "doc-link", False),
    ("Jigokudani Monkey Park", "Yamanouchi", "Nagano", 36.7326, 138.4622, "nature", "Snow monkeys bathing in hot springs (best in winter).", "doc-link", False),
    ("Sagano (Arashiyama) Bamboo Forest", "Kyoto", "Kyoto", 35.0170, 135.6719, "nature", "Towering bamboo grove; go at sunrise to beat the crowds.", "doc-link", False),
    ("Little World Museum of Man", "Inuyama", "Aichi", 35.3285, 137.0138, "fun", "Open-air anthropology theme park with buildings and food from ~20 countries.", "doc-text", False),
    ("Maishima Incineration Plant", "Osaka", "Osaka", 34.6494, 135.4006, "weird", "Hundertwasser-designed waste plant that looks like a fairytale castle.", "doc-text", False),
    ("Cup Noodles Museum Osaka Ikeda", "Ikeda", "Osaka", 34.8216, 135.4248, "museum", "Make your own Cup Noodle where instant ramen was invented.", "doc-text", False),
    ("Miyoshi Mononoke Museum", "Miyoshi", "Hiroshima", 34.8018, 132.8565, "yokai", "Japan's yokai museum, built around the Inoue/Yumoto collection.", "doc-link", False),
    ("Lake Imba Monster", "Sakura (Lake Inba)", "Chiba", 35.7600, 140.1950, "yokai", "Local legend of a monster in Lake Inba-numa.", "doc-link", True),
    ("Funato Kappa Park", "Lake Inba (SW shore)", "Chiba", 35.7480, 140.1600, "yokai", "Homemade kappa statues, each with its own personality.", "doc-link", True),
    ("Weird Museum for Boys and Girls", "Ito (Izu-kogen)", "Shizuoka", 34.9145, 139.1255, "weird", "Kitsch pop-culture and Showa-era oddities museum.", "doc-link", True),
    ("Hachijo Royal Hotel (abandoned)", "Hachijojima", "Tokyo", 33.1105, 139.7935, "abandoned", "Japan's largest abandoned hotel on remote Hachijo island. Exterior only.", "doc-link", False),
    # --- From the screenshots in the document ---
    ("Tenshou-Kyousha Shrine Mermaid Mummy", "Fujinomiya", "Shizuoka", 35.2500, 138.6000, "weird", "Reportedly 1,400-year-old mermaid mummy.", "doc-image", True),
    ("Henn-na Hotel", "Sasebo (Huis Ten Bosch)", "Nagasaki", 33.0860, 129.7880, "weird", "Hotel run by robots, incl. dinosaur receptionists.", "doc-image", False),
    ("Atomic Bomb Medical Museum", "Nagasaki", "Nagasaki", 32.7660, 129.8665, "history", "Medical effects of the Nagasaki bombing (Nagasaki University).", "doc-image", False),
    ("Museum of Tropical Medicine", "Nagasaki", "Nagasaki", 32.7672, 129.8678, "museum", "Specimens and history of tropical diseases (Nagasaki University).", "doc-image", False),
    ("Tobacco & Salt Museum", "Sumida, Tokyo", "Tokyo", 35.7020, 139.8155, "museum", "Cultural history of tobacco and salt, once state monopolies.", "doc-image", False),
    ("Tamon-ji (Tanuki Temple)", "Sumida, Tokyo", "Tokyo", 35.7290, 139.8190, "yokai", "Tanuki legend, a rare Edo-era wooden gate, survivor of the Tokyo bombings.", "doc-image", False),
    ("Tomb of Jesus Christ", "Shingo", "Aomori", 40.4627, 141.1666, "weird", "Village claiming to be Jesus's final resting place.", "doc-image", False),
    ("Taiyo Park", "Himeji", "Hyogo", 34.8880, 134.6490, "weird", "Overgrown park full of replica world landmarks and stone figures.", "doc-image", True),
    ("Kaiyodo Kappa Museum", "Shimanto-cho", "Kochi", 33.2040, 133.0280, "yokai", "Whimsical museum devoted to the cucumber-loving kappa.", "doc-image", True),
    ("Hundred Caves of Yoshimi", "Yoshimi", "Saitama", 36.0390, 139.4290, "history", "Ancient hillside burial caves.", "doc-image", False),
    ("Nima Sand Museum", "Oda", "Shimane", 35.1125, 132.3480, "museum", "Glass pyramids housing the world's largest hourglass, near singing-sand beach.", "doc-image", False),
    ("Radium Onsen", "Osaka", "Osaka", 34.6900, 135.5000, "relax", "Old bathhouse with an option to soak in (mildly) radioactive water.", "doc-image", True),
    ("Mount Tanigawa", "Minakami", "Gunma", 36.8374, 138.9297, "nature", "Beautiful but notoriously deadly mountain; take the ropeway for views.", "doc-image", False),
    ("Doai Station", "Minakami", "Gunma", 36.8329, 138.9653, "weird", "Japan's 'mole station', 462 steps underground.", "doc-image", False),
    ("Hida Takayama Teddy Bear Eco Village", "Takayama", "Gifu", 36.1495, 137.2520, "museum", "1,000+ teddy bears dressed for every profession.", "doc-image", False),
    ("Takayama Showa-kan Museum", "Takayama", "Gifu", 36.1418, 137.2565, "museum", "60 years of Showa pop culture, from Godzilla to Hulk Hogan.", "doc-image", False),
    ("Nawate Dori (Frog Street)", "Matsumoto", "Nagano", 36.2335, 137.9705, "shopping", "Riverside street of frog statues, stalls and a frog shrine.", "doc-image", False),
    ("Kappabashi Sampuru Shops", "Taito, Tokyo", "Tokyo", 35.7130, 139.7885, "shopping", "'Kitchen Town' with shops selling realistic plastic food replicas.", "doc-image", False),
    ("Tetsugakudo Park", "Nakano, Tokyo", "Tokyo", 35.7155, 139.6452, "weird", "Philosophy-themed park founded by an occult expert.", "doc-image", False),
    ("Yokai Art Museum", "Tonosho (Shodoshima)", "Kagawa", 34.4865, 134.1925, "yokai", "Contemporary yokai art in old warehouses on Shodoshima.", "doc-image", True),
    ("Green Thumb", "Yokohama", "Kanagawa", 35.4415, 139.6490, "shopping", "Herbal teas, cosmetics and 'kitchen witch' dolls.", "doc-image", True),
    ("Sanatorium – Wonder Museum Annex", "Fukuoka", "Fukuoka", 33.5880, 130.3950, "food", "Tuberculosis-sanatorium-themed cafe doubling as an underground gallery.", "doc-image", True),
    ("Kenashi Pond (Seiryu Shrine)", "Katsushika, Tokyo", "Tokyo", 35.7530, 139.8650, "yokai", "Pond said to be haunted by a giant white snake.", "doc-image", True),
    ("Kabosu the Doge Statue", "Sakura", "Chiba", 35.7484, 140.2260, "weird", "Bronze statue of the shiba inu behind the 'Doge' meme (Sakura Furusato Hiroba).", "doc-image", False),
    ("Tomb of the Nue", "Miyakojima, Osaka", "Osaka", 34.7050, 135.5255, "yokai", "Tomb of a chimeric monster whose corpse washed ashore in Osaka.", "doc-image", False),
    ("Ogushi Kaizuka Park", "Mito", "Ibaraki", 36.4170, 140.4740, "history", "Shell-midden park with a giant statue of the clam-eating giant Daidarabotchi.", "doc-image", False),
    # --- Added by you ---
    ("Hiroshima Peace Memorial (Atomic Bomb Dome)", "Hiroshima", "Hiroshima", 34.3955, 132.4536, "history", "A-Bomb Dome, Peace Memorial Park and Museum.", "added", False),
    ("Nagoya Castle", "Nagoya", "Aichi", 35.1856, 136.8999, "history", "Golden shachihoko and the rebuilt Honmaru Palace.", "added", False),
    ("RAKU SPA GARDEN Nagoya", "Meito, Nagoya", "Aichi", 35.1695, 137.0225, "relax", "Large spa with natural hot spring and bedrock baths.", "added", True),
    ("Ishigaki Island", "Ishigaki", "Okinawa", 24.4064, 124.1754, "nature", "Kabira Bay, manta snorkelling, gateway to the Yaeyama islands.", "added", False),
    ("Immersive Journey Nagoya", "Sakae, Nagoya", "Aichi", 35.1680, 136.9070, "fun", "Immersive digital-art/VR venue, Skyle 10F, Sakae (opened Jan 2026).", "added", False),
    ("Monet's Pond (Nemichi Shrine pond)", "Seki", "Gifu", 35.6430, 136.8350, "nature", "Clear spring pond with koi that looks like Monet's Water Lilies.", "added", False),
    ("Asakura Museum of Sculpture", "Yanaka, Tokyo", "Tokyo", 35.7270, 139.7690, "art", "Sculptor Asakura Fumio's house, studio and rooftop garden.", "added", False),
    ("Mount Osore (Osorezan Bodaiji)", "Mutsu", "Aomori", 41.3270, 141.0890, "spiritual", "Volcanic 'gateway to the underworld' temple. Open May–Oct.", "added", False),
    ("Maboroshi Hakurankai", "Ito (Izu-kogen)", "Shizuoka", 34.9390, 139.1050, "weird", "Sprawling kitsch museum/junkyard of oddities. Check it's open before going.", "added", True),
    ("Pokémon × Kōgei (at Tohoku History Museum)", "Tagajo", "Miyagi", 38.3068, 140.9972, "art", "Pokémon x traditional crafts exhibition — final Japan venue, 10 Oct – 27 Dec 2026.", "added", False),
    ("Nagashima Spa Land", "Kuwana", "Mie", 35.0310, 136.7330, "fun", "Roller-coaster theme park plus the huge Yuami-no-Shima onsen.", "added", False),
    ("X-Gold Club Nagoya Johoku", "Nagoya (Johoku)", "Aichi", 35.2000, 136.8900, "fun", "Couldn't verify the exact venue — drag the pin to the right spot.", "added", True),
    ("TOHO Cinemas Nagoya Sakae", "Sakae, Nagoya", "Aichi", 35.1708, 136.9068, "fun", "10-screen cinema in The Landmark Nagoya Sakae, 5F (opened June 2026).", "added", False),
    ("Hikaru Museum", "Takayama", "Gifu", 36.1530, 137.2395, "art", "Art museum with Egyptian-style architecture and Japanese & Western works.", "added", False),
    ("Tokugawa Art Museum", "Nagoya", "Aichi", 35.1845, 136.9335, "art", "Owari Tokugawa treasures incl. Tale of Genji scrolls; Tokugawa-en garden next door.", "added", False),
    ("Nagoya Touken World (Samurai Museum)", "Nakamura, Nagoya", "Aichi", 35.1735, 136.8875, "history", "Swords, armour and samurai history near Nagoya Station.", "added", True),
    ("Fukusaki Yokai (Tsujikawayama Park)", "Fukusaki", "Hyogo", 34.9505, 134.7600, "yokai", "Hometown of yokai scholar Kunio Yanagita; the kappa that rises from the pond, yokai benches around town.", "added", False),
    ("Tohoku History Museum", "Tagajo", "Miyagi", 38.3060, 140.9960, "history", "History of the Tohoku region from prehistory onward.", "added", False),
    ("Naoshima (Art Island)", "Naoshima", "Kagawa", 34.4600, 133.9950, "art", "Chichu Art Museum, Benesse House, Art House Project, Kusama's pumpkins.", "added", False),
    ("National Museum of Modern Art, Tokyo (MOMAT)", "Chiyoda, Tokyo", "Tokyo", 35.6905, 139.7546, "art", "Japan's leading modern art collection, by the Imperial Palace moat.", "added", False),
    ("Meguro Parasitological Museum", "Meguro, Tokyo", "Tokyo", 35.6315, 139.7065, "museum", "Free museum of parasites incl. an 8.8 m tapeworm.", "added", False),
    ("Nagoya City Art Museum", "Naka, Nagoya", "Aichi", 35.1640, 136.8985, "art", "Kisho Kurokawa building in Shirakawa Park (with the Science Museum).", "added", False),
    ("Matsuzakaya Art Museum", "Sakae, Nagoya", "Aichi", 35.1650, 136.9065, "art", "Exhibition space in Matsuzakaya Nagoya department store.", "added", True),
    ("TODAYS GALLERY STUDIO. NAGOYA", "Shinsakae, Nagoya", "Aichi", 35.1695, 136.9215, "art", "Pop-up exhibition gallery (1-17-12 Shinsakae). Check what's showing.", "added", False),
    ("Injuma Art House Project (a-art house)", "Nagoya", "Aichi", 35.1700, 136.9050, "art", "Couldn't verify the exact venue — drag the pin to the right spot.", "added", True),
    ("Meiho Ski Resort", "Gujo", "Gifu", 35.9190, 137.0440, "nature", "Ski resort in Gujo (winter).", "added", True),
    ("Takayama Old Town", "Takayama", "Gifu", 36.1408, 137.2595, "history", "Edo-era merchant streets (Sanmachi), morning markets, Hida beef.", "added", False),
    ("Higashiyama Zoo & Botanical Gardens", "Chikusa, Nagoya", "Aichi", 35.1560, 136.9775, "nature", "Big zoo (Shabani the gorilla) and botanical gardens.", "added", False),
    ("Showa-Shinzan Bear Ranch", "Sobetsu", "Hokkaido", 42.5480, 140.8670, "nature", "Brown bear park beside the Showa-Shinzan lava dome near Lake Toya.", "added", False),
    ("Grano Grano (APITA Chiyodabashi)", "Chikusa, Nagoya", "Aichi", 35.1915, 136.9585, "food", "In-store bakery inside APITA Chiyodabashi.", "added", False),
    ("Sushiro Nagoya Shinsakae", "Shinsakae, Nagoya", "Aichi", 35.1685, 136.9230, "food", "Conveyor-belt sushi.", "added", True),
]

REGIONS = {
    "Hokkaido": "Hokkaido", "Aomori": "Tohoku", "Iwate": "Tohoku", "Miyagi": "Tohoku", "Yamagata": "Tohoku",
    "Tokyo": "Kanto", "Kanagawa": "Kanto", "Chiba": "Kanto", "Saitama": "Kanto", "Ibaraki": "Kanto", "Tochigi": "Kanto", "Gunma": "Kanto",
    "Aichi": "Chubu", "Gifu": "Chubu", "Nagano": "Chubu", "Shizuoka": "Chubu",
    "Kyoto": "Kansai", "Osaka": "Kansai", "Hyogo": "Kansai", "Mie": "Kansai",
    "Hiroshima": "Chugoku", "Shimane": "Chugoku",
    "Tokushima": "Shikoku", "Kochi": "Shikoku", "Kagawa": "Shikoku",
    "Nagasaki": "Kyushu", "Fukuoka": "Kyushu", "Okinawa": "Okinawa",
}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def build():
    places, seen = [], set()
    for name, city, pref, lat, lng, cat, note, src, approx in P:
        pid = "jp-" + slug(name)
        assert pid not in seen, f"duplicate: {name}"
        assert cat in CATEGORIES, cat
        seen.add(pid)
        places.append({
            "id": pid, "name": name, "city": city, "prefecture": pref, "region": REGIONS[pref],
            "country": "Japan", "lat": lat, "lng": lng, "category": cat, "note": note,
            "source": src, "approx": approx,
        })

    site = ROOT / "site"; site.mkdir(exist_ok=True)
    (site / "places.js").write_text(
        "// Generated by tools/build_data.py — edit there, not here.\n"
        f"window.CATEGORIES = {json.dumps(CATEGORIES, ensure_ascii=False, indent=1)};\n"
        f"window.SEED_PLACES = {json.dumps(places, ensure_ascii=False, indent=1)};\n",
        encoding="utf-8")

    out = ROOT / "exports"; out.mkdir(exist_ok=True)

    # KML: one folder (= one layer in Google My Maps) per category
    kml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Japan – Places to Go</name>']
    for key, c in CATEGORIES.items():
        hexc = c["color"].lstrip("#")
        kml.append(f'<Style id="{key}"><IconStyle><color>ff{hexc[4:6]}{hexc[2:4]}{hexc[0:2]}</color>'
                   '<Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>')
    for key, c in CATEGORIES.items():
        items = [p for p in places if p["category"] == key]
        if not items:
            continue
        kml.append(f"<Folder><name>{escape(c['label'])}</name>")
        for p in items:
            desc = f"{p['note']}\n{p['city']}, {p['prefecture']}" + ("\n(approximate location)" if p["approx"] else "")
            kml.append(f"<Placemark><name>{escape(p['name'])}</name><description>{escape(desc)}</description>"
                       f"<styleUrl>#{key}</styleUrl><Point><coordinates>{p['lng']},{p['lat']},0</coordinates></Point></Placemark>")
        kml.append("</Folder>")
    kml.append("</Document></kml>")
    (out / "japan-places.kml").write_text("\n".join(kml), encoding="utf-8")

    with open(out / "japan-places.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["Name", "Category", "City", "Prefecture", "Region", "Latitude", "Longitude", "Notes", "Approximate"])
        for p in places:
            w.writerow([p["name"], CATEGORIES[p["category"]]["label"], p["city"], p["prefecture"], p["region"],
                        p["lat"], p["lng"], p["note"], "yes" if p["approx"] else ""])

    counts = {}
    for p in places:
        counts[p["category"]] = counts.get(p["category"], 0) + 1
    print(len(places), "places;", counts)


if __name__ == "__main__":
    build()
