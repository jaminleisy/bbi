"""Quick smoke tests for manufacturer extraction, shorthand expansion, and
CPU-manufacturer inference."""
import import_builds as ib

cases = [
    # (input model text, expected mfr, expected model)
    ("850w dflash vmt",                "darkFlash",       "850w vmt"),
    ("b650m k gbyte",                  "Gigabyte",        "b650m k"),
    ("clrmstr q300l",                  "Cooler Master",   "q300l"),
    ("clmstr q300l",                   "Cooler Master",   "q300l"),
    ("deepcool ak620",                 "DeepCool",        "ak620"),
    ("Dracena matx",                   "Dracena",         "matx"),
    ("Jonsbo c2",                      "Jonsbo",          "c2"),
    ("Allied matx rgb",                "Allied",          "matx rgb"),
    ("5060 msi shadow2x",              "MSI",             "5060 shadow2x"),
    ("th-righ pa120",                  "Thermalright",    "pa120"),
    ("th-take toughair 510",           "Thermaltake",     "toughair 510"),
    ("wd 850x 1tb",                    "Western Digital", "850x 1tb"),
    ("sp us75 1tb",                    "Silicon Power",   "us75 1tb"),
    ("sung 990 pro",                   "Samsung",         "990 pro"),
    ("Samsung 970 evo",                "Samsung",         "970 evo"),
    ("2x16 tgroup 6000",               "TeamGroup",       "2x16 6000"),
    ("2x16 team group 6000",           "TeamGroup",       "2x16 6000"),
    ("aio ID-C frostflow 240",         "ID Cooling",      "aio frostflow 240"),
    ("g skill fk 2x16 6000",           "G.Skill",         "fk 2x16 6000"),
    ("Lian Li strimer 24pin",          "Lian Li",         "strimer 24pin"),
    ("SK Hynix p31 1tb",               "SK Hynix",        "p31 1tb"),
    # implied-manufacturer fallbacks
    ("t-force delta 2x16",             "TeamGroup",       "t-force delta 2x16"),
    ("t-create 2x16",                  "TeamGroup",       "t-create 2x16"),
    ("omen 25l case",                  "HP",              "omen 25l case"),
    ("rog strix b650-e",               "ASUS",            "rog strix b650-e"),
    ("3090 fe",                        "Nvidia",          "3090 Founders Edition"),
    # shorthand expansion (no manufacturer needed to trigger)
    ("dflash fi cooler",               "darkFlash",       "Frozen Infinity cooler"),
    ("dflash fwU cooler",              "darkFlash",       "Frozen Warframe Ultra cooler"),
    ("dflash fw cooler",               "darkFlash",       "Frozen Warframe cooler"),
    ("dflash fn cooler",               "darkFlash",       "Frozen Notte cooler"),
    ("th-take asdigital",              "Thermaltake",     "Assasin Digital"),
    ("arctic lf2 240",                 "Arctic",          "Liquid Freezer II 240"),
    ("arctic lfII 240",                "Arctic",          "Liquid Freezer II 240"),
    ("arctic lf3 360",                 "Arctic",          "Liquid Freezer III 360"),
    ("dflash gv case",                 "darkFlash",       "Grand Vision case"),
    ("clrmstr hyp212",                 "Cooler Master",   "Hyper 212"),
    ("th-take aev5",                   "Thermaltake",     "Aqua Elite V5"),
    ("th-take aev6",                   "Thermaltake",     "Aqua Elite V6"),
    ("corsair domin8 2x16",            "Corsair",         "Dominator 2x16"),
    ("g skill rj 2x16",                "G.Skill",         "Ripjaws 2x16"),
    ("g skill triz 2x16",              "G.Skill",         "Trident Z 2x16"),
    ("msi vent",                       "MSI",             "Ventus"),
    ("msi vent2x 4060",                "MSI",             "Ventus 2x 4060"),
    ("msi vent3x 4060",                "MSI",             "Ventus 3x 4060"),
    ("msi gamtrio 4070",               "MSI",             "Gaming Trio 4070"),
    ("msi gamx 4070",                  "MSI",             "Gaming X 4070"),
    ("msi gamxtrio 4070",              "MSI",             "Gaming X Trio 4070"),
    ("msi apoc",                       "MSI",             "Apocalypse"),
    ("msi gam 3060",                   "MSI",             "Gaming 3060"),
    ("mont twr250",                    "Montech",         "Tower 250"),
    ("mont twr300",                    "Montech",         "Tower 300"),
    # New brand aliases (round 2): brand names are removed from the model,
    # product lines stay (Aorus, XLR8, Trident all fall in the latter camp).
    ("2tb crucial p3",                 "Crucial",         "2tb p3"),
    ("850w segotep gm850",             "Segotep",         "850w gm850"),
    ("2x16 5600 patriot rgb",          "Patriot",         "2x16 5600 rgb"),
    ("cougar archon",                  "Cougar",          "archon"),
    ("850w redragon rgb",              "Redragon",        "850w rgb"),
    ("600w apevia sprt",               "Apevia",          "600w sprt"),
    ("2tb lexar Gen4",                 "Lexar",           "2tb Gen4"),
    ("2x16 3200 siliconpower",         "Silicon Power",   "2x16 3200"),
    ("alienware 3090",                 "Alienware",       "3090"),
    ("2tb solidigm p41 plus",          "Solidigm",        "2tb p41 plus"),
    ("2x16 3600 timetec rgb",          "Timetec",         "2x16 3600 rgb"),
    # Product-line fallbacks keep the line name in the model.
    ("x570s aorus master",             "Gigabyte",        "x570s aorus master"),
    ("2x16 3200 xlr8 rgb",             "PNY",             "2x16 3200 xlr8 rgb"),
    ("2x8 3200 trident",               "G.Skill",         "2x8 3200 trident"),
    ("2x16 3600 trident black",        "G.Skill",         "2x16 3600 trident black"),
    ("2x16 3600 trident z black",      "G.Skill",         "2x16 3600 trident z black"),
    ("2x16 6000 triz",                 "G.Skill",         "2x16 6000 Trident Z"),
    # Explicit brand + product line: brand is removed, product line stays.
    ("gbyte b550 aorus master",        "Gigabyte",        "b550 aorus master"),
    ("pny xlr8 4070",                  "PNY",             "xlr8 4070"),
    ("g skill triz 2x16",              "G.Skill",         "Trident Z 2x16"),
    # Round 3 brand aliases (removed from model)
    ("500w seasonic",                  "Seasonic",        "500w"),
    ("750w seasonic plat",             "Seasonic",        "750w plat"),
    ("1000w aresgame",                 "Aresgame",        "1000w"),
    ("2x8 3000 neo forza red",         "Neo Forza",       "2x8 3000 red"),
    ("2x16 3600 neo forza",            "Neo Forza",       "2x16 3600"),
    ("2x16 4000 mushkin",              "Mushkin",         "2x16 4000"),
    ("2tb mushkin redline",            "Mushkin",         "2tb redline"),
    ("2x8 3000 zadek",                 "Zadek",           "2x8 3000"),
    ("SZSKYING black 9 fan",           "SZSKYING",        "black 9 fan"),
    ("2tb acclamator",                 "Acclamator",      "2tb"),
    ("1.6tb fuzedrive gen3",           "Fuzedrive",       "1.6tb gen3"),
    ("2tb intel 660p",                 "Intel",           "2tb 660p"),
    # Round 3 product-line fallbacks (kept in model, imply manufacturer)
    ("b650m wifi tuf",                 "ASUS",            "b650m wifi tuf"),
    ("z790 wifi tuf",                  "ASUS",            "z790 wifi tuf"),
    ("b550m steelegend",               "ASRock",          "b550m steelegend"),
    ("3070 ftw3",                      "EVGA",            "3070 ftw3"),
    ("wraith prism",                   "AMD",             "wraith prism"),
    ("ryzen stock",                    "AMD",             "ryzen stock"),
    # sl expands to "Steel Legend" AND infers ASRock
    ("b550m sl",                       "ASRock",          "b550m Steel Legend"),
    ("b650 sl wifi",                   "ASRock",          "b650 Steel Legend wifi"),
    # Explicit brand + sl: brand removed, sl still expanded
    ("ASRock b550m sl",                "ASRock",          "b550m Steel Legend"),
]

# CPU manufacturer inference cases (Intel / AMD)
cpu_cases = [
    ("5800x",                       "AMD"),
    ("9600x",                       "AMD"),
    ("9800X3D",                     "AMD"),
    ("7700x",                       "AMD"),
    ("7800x3d",                     "AMD"),
    ("3600",                        "AMD"),
    ("5900x",                       "AMD"),
    ("7600",                        "AMD"),
    ("9400f",                       "AMD"),
    ("5900xt",                      "AMD"),
    ("5600g",                       "AMD"),
    ("2400g",                       "AMD"),
    ("2600 unknown",                "AMD"),
    ("5600x from mark",             "AMD"),
    ("7600x BAD",                   "AMD"),
    ("9800x3d from trade alex mason","AMD"),
    ("8700g",                       "AMD"),
    ("fx6300",                      "AMD"),
    ("a8-9600",                     "AMD"),
    ("ryzen 5 3600",                "AMD"),
    ("local1650 ryzen 3 2200g",     "AMD"),
    # Intel
    ("12600k",                      "Intel"),
    ("12600kf",                     "Intel"),
    ("13700kf",                     "Intel"),
    ("14700k",                      "Intel"),
    ("14900kf",                     "Intel"),
    ("10400",                       "Intel"),
    ("10600kf",                     "Intel"),
    ("11400f",                      "Intel"),
    ("11700f",                      "Intel"),
    ("6700k",                       "Intel"),
    ("7600k",                       "Intel"),
    ("8350k",                       "Intel"),
    ("9700k",                       "Intel"),
    ("9900k",                       "Intel"),
    ("i5",                          "Intel"),
    ("i5 3570k",                    "Intel"),
    ("i7 13700k",                   "Intel"),
    ("i7 4790",                     "Intel"),
    ("i7 8700",                     "Intel"),
    ("G6900 test",                  "Intel"),
    # Unclassifiable garbage rows in the CPU column
    ("customer cpu",                None),
    ("280 AIO rgb",                 None),
    ("850w a850gl",                 None),
]


def _run() -> None:
    fails = 0
    for raw, exp_mfr, exp_model in cases:
        got_model, got_mfr = ib.extract_manufacturer(raw)
        got_model = ib.expand_model_shorthand(got_model)
        if got_mfr is None:
            got_model, got_mfr = ib.apply_special_fallback(got_model)
        ok = (got_mfr == exp_mfr) and (got_model == exp_model)
        if not ok:
            fails += 1
            print(f"FAIL  {raw!r}")
            print(f"    expected mfr={exp_mfr!r}, model={exp_model!r}")
            print(f"    got      mfr={got_mfr!r}, model={got_model!r}")
    print()

    cpu_fails = 0
    for raw, exp_mfr in cpu_cases:
        got = ib.infer_cpu_manufacturer(raw)
        if got != exp_mfr:
            cpu_fails += 1
            print(f"FAIL  cpu {raw!r}: expected {exp_mfr!r}, got {got!r}")

    total = len(cases) + len(cpu_cases)
    total_fails = fails + cpu_fails
    if total_fails == 0:
        print(f"OK - all {total} cases passed "
              f"({len(cases)} parser, {len(cpu_cases)} cpu inference).")
    else:
        print(f"{total_fails}/{total} case(s) failed.")

_run()
