// Official turn numbers on the circuits: where each turn's apex is, in metres
// along the lap from the start line (the built centreline). The real circuits
// were placed by hand against each one's official numbered map (formula1.com,
// checked against Wikipedia's); check or redo one with
// `npx tsx scripts/turnmap.ts <slug> out.png --data`. Gentle kinks the game's
// own corner finder misses are placed by eye and may be tens of metres out.
// The Rookie Ring's come from its plan (scripts/rookie-ring.ts). The Toybox
// edition uses src/data/toybox/turns.ts, generated from its corner lists.

export const TURNS: Record<string, number[]> = {
  'rookie-ring': [250, 454, 540, 696, 1026, 1394],
  // high confidence, from https://media.formula1.com/image/upload/f_png,c_limit,q_auto,w_1600/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Australia_Circuit
  melbourne: [334, 442, 1066, 1206, 1424, 1852, 1934, 2126, 3283, 3413, 4087, 4349, 4605, 4753],
  // high confidence, from https://media.formula1.com/image/upload/f_png,c_limit,q_auto,w_1600/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/China_Circuit
  shanghai: [200, 395, 515, 635, 950, 1196, 1654, 1980, 2155, 2270, 2750, 2820, 2990, 4395, 4475, 4760],
  // high confidence, from https://media.formula1.com/image/upload/f_png,c_limit,q_auto,w_1600/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Japan_Circuit
  suzuka: [470, 614, 874, 988, 1152, 1326, 1530, 2064, 2226, 2554, 2692, 2940, 3585, 3750, 4745, 5163, 5217, 5315],
  // high confidence, from https://media.formula1.com/image/upload/f_png,c_limit,q_auto,w_1600/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Bahrain_Circuit
  bahrain: [570, 666, 778, 1372, 1636, 1736, 1854, 2108, 2482, 2574, 3295, 3677, 3961, 4760, 4840],
  // medium confidence, from https://media.formula1.com/image/upload/f_png,c_limit,q_auto,w_1600/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Saudi_Arabia_Circuit
  jeddah: [442, 502, 650, 956, 1076, 1228, 1338, 1414, 1568, 1668, 1775, 1875, 2395, 2690, 2965, 3050, 3135, 3265, 3540, 3740, 4000, 4255, 4360, 4480, 4740, 5250, 5527],
  // high confidence, from https://media.formula1.com/image/upload/f_png,c_limit,q_auto,w_1600/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Miami_Circuit
  miami: [254, 350, 458, 1016, 1154, 1290, 1460, 1535, 2055, 2390, 3000, 3130, 3245, 3330, 3360, 3447, 4771, 4916, 5128],
  // high confidence, from https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Emilia_Romagna_Circuit.webp
  imola: [28, 696, 754, 886, 1330, 1412, 1710, 2090, 2329, 2505, 2733, 2847, 2911, 3351, 3385, 3947, 4133, 4261, 4618],
  // medium confidence, from https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Monaco_Circuit.webp
  monaco: [160, 538, 712, 844, 1076, 1206, 1282, 1370, 1722, 2025, 2057, 2310, 2461, 2503, 2627, 2659, 2775, 2845, 2930],
  // high confidence, from https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Spain_Circuit.webp
  barcelona: [718, 820, 1060, 1610, 2020, 2252, 2430, 2515, 2786, 3375, 3500, 3670, 3956, 4232],
  // high confidence, from https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Canada_Circuit.webp
  montreal: [454, 535, 928, 986, 1214, 1452, 1525, 2207, 2262, 2896, 3022, 3398, 4100, 4135],
  // high confidence, from https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Austria_Circuit.webp
  spielberg: [327, 970, 1263, 2072, 2206, 2599, 2915, 3087, 3640, 3860],
  // high confidence, from https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Great_Britain_Circuit.webp
  silverstone: [3466, 3693, 3950, 4096, 4295, 5040, 5241, 5603, 260, 784, 885, 1050, 1196, 1355, 2227, 2689, 2760, 2935],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Belgium_Circuit
  spa: [245, 905, 1015, 1135, 2280, 2350, 2510, 2905, 3135, 3685, 3890, 4365, 4515, 4820, 5015, 5725, 6040, 6590, 6645],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Hungary_Circuit
  hungaroring: [362, 872, 1054, 1538, 1790, 2108, 2148, 2320, 2455, 2662, 2840, 3255, 3520, 3820],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Netherlands_Circuit
  zandvoort: [450, 755, 918, 1130, 1305, 1485, 1775, 2095, 2330, 2590, 3170, 3250, 3590, 3840],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Italy_Circuit
  monza: [620, 665, 1110, 1832, 1872, 2245, 2565, 3640, 3740, 3835, 4910],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Baku_Circuit
  baku: [180, 515, 1385, 1605, 1940, 1995, 2385, 2585, 2610, 2640, 2680, 2750, 3150, 3365, 3595, 3945, 4120, 4378, 4520, 4880],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Singapore_Circuit
  singapore: [295, 360, 445, 580, 845, 1300, 1670, 1880, 2080, 2520, 2650, 2710, 2925, 3470, 3710, 4205, 4270, 4560, 4660],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/USA_Circuit
  austin: [338, 580, 850, 946, 1036, 1206, 1404, 1568, 1660, 1866, 2266, 3462, 3682, 3778, 3966, 4190, 4290, 4505, 4724, 5024],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Mexico_Circuit
  'mexico-city': [1156, 1242, 1292, 1992, 2062, 2210, 2546, 2650, 2730, 2930, 3020, 3588, 3768, 3826, 3874, 3950, 4090],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Brazil_Circuit
  interlagos: [314, 416, 590, 1376, 1556, 1990, 2118, 2296, 2436, 2718, 2928, 3210, 3346, 3615, 3980],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Las_Vegas_Circuit
  'las-vegas': [140, 225, 365, 500, 1422, 1730, 1894, 1950, 2085, 2580, 2870, 3082, 3750, 5038, 5074, 5140, 5965],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Qatar_Circuit
  lusail: [518, 828, 1058, 1465, 1640, 1932, 2335, 2540, 2680, 2910, 3140, 3530, 3725, 3930, 4254, 4725],
  // high confidence, from https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Abu_Dhabi_Circuit
  'yas-marina': [265, 518, 720, 940, 1326, 2522, 2586, 2790, 3620, 3968, 4104, 4236, 4352, 4462, 4766, 4984],
};
