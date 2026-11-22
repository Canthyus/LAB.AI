-- Catálogo de modelos.
-- verified = true  -> consta na documentação oficial da Agnes (catálogo de 2026-07-30).
-- verified = false -> nome citado no briefing, mas ausente do catálogo oficial; fica DESABILITADO
--                     até a descoberta via GET /v1/models (Configurações > Descobrir modelos) confirmar.
-- Presets de tamanho/duração em "capabilities" são os que o app oferece na interface; edite aqui
-- (sem rebuild) se a API aceitar outros valores. Os marcados "unverified_presets" ainda não foram
-- testados com chamadas reais.
insert into public.ai_models (kind, model_id, label, enabled, verified, capabilities, sort_order) values
('text', 'agnes-2.5-flash', 'Agnes 2.5 Flash (texto)', true, true,
  '{"streaming": true, "vision": true, "context": 512000, "max_output": 65500}', 10),

('image', 'agnes-image-2.1-flash', 'Agnes Image 2.1 Flash', true, true,
  '{"reference_images": true, "unverified_presets": true,
    "sizes": {"1:1": "1024x1024", "16:9": "1280x720", "9:16": "720x1280", "4:3": "1024x768"},
    "default_size": "1024x768"}', 10),
('image', 'agnes-image-2.0-flash', 'Agnes Image 2.0 Flash (rápido)', true, true,
  '{"reference_images": true, "unverified_presets": true,
    "sizes": {"1:1": "1024x1024", "16:9": "1280x720", "9:16": "720x1280", "4:3": "1024x768"},
    "default_size": "1024x768"}', 20),
('image', 'agnes-image-2.5-flash', 'Agnes Image 2.5 Flash (não confirmado)', false, false,
  '{"reference_images": true, "sizes": {"1:1": "1024x1024", "16:9": "1280x720", "9:16": "720x1280"}, "default_size": "1024x1024"}', 90),

('video', 'agnes-video-v2.0', 'Agnes Video v2.0', true, true,
  '{"image_to_video": true, "keyframes": true, "async": true, "unverified_presets": true,
    "resolutions": {"16:9": {"width": 1152, "height": 640}, "9:16": {"width": 640, "height": 1152}, "1:1": {"width": 768, "height": 768}},
    "frame_rate_options": [24],
    "num_frames_options": [49, 97, 121],
    "default_num_frames": 121, "default_frame_rate": 24,
    "known_good": {"width": 1152, "height": 768, "num_frames": 121, "frame_rate": 24}}', 10),
('video', 'agnes-video-2.5', 'Agnes Video 2.5 (não confirmado)', false, false,
  '{"image_to_video": true, "keyframes": false, "async": true,
    "resolutions": {"16:9": {"width": 1152, "height": 640}, "9:16": {"width": 640, "height": 1152}, "1:1": {"width": 768, "height": 768}},
    "frame_rate_options": [24], "num_frames_options": [121], "default_num_frames": 121, "default_frame_rate": 24}', 90),
('video', 'agnes-video-2.5-flash', 'Agnes Video 2.5 Flash (não confirmado)', false, false,
  '{"image_to_video": true, "keyframes": false, "async": true,
    "resolutions": {"16:9": {"width": 1152, "height": 640}, "9:16": {"width": 640, "height": 1152}, "1:1": {"width": 768, "height": 768}},
    "frame_rate_options": [24], "num_frames_options": [121], "default_num_frames": 121, "default_frame_rate": 24}', 91)
on conflict (model_id) do nothing;

-- Estilos visuais do sistema. "prompt_modifier" (inglês) é anexado a todo prompt de imagem/vídeo.
insert into public.visual_styles (user_id, slug, name, description, config) values
(null, 'cinema-realista', 'Cinema realista', 'Imagem natural, fotografia de longa-metragem dramático.', $j$
{"lighting":"natural motivated light, soft window light, practical lamps","photography":"35mm full-frame, shallow depth of field, subtle film grain","palette":["#2b2b2b","#8a7f72","#c9b79c","#3f5a6c"],"textures":"skin pores, fabric weave, weathered surfaces","environments":"real locations, lived-in interiors","cinematic_language":"handheld naturalism, long takes, restrained camera moves","prompt_modifier":"photorealistic cinematic film still, natural lighting, 35mm lens, shallow depth of field, subtle film grain, realistic skin and fabric textures"}$j$),
(null, 'animacao-3d', 'Animação 3D', 'CGI estilizado com materiais suaves e iluminação de estúdio.', $j$
{"lighting":"soft global illumination with rim light","photography":"virtual camera, wide-angle lens, clean depth of field","palette":["#ff9f43","#54a0ff","#5f27cd","#feca57"],"textures":"smooth subsurface materials, stylized fabric","environments":"stylized sets, clean props","cinematic_language":"expressive staging, dynamic camera swoops","prompt_modifier":"high quality 3D animated film render, stylized CGI characters, soft global illumination, rim lighting, smooth subsurface materials"}$j$),
(null, 'animacao-2d', 'Animação 2D', 'Desenho animado tradicional com contornos e cores chapadas.', $j$
{"lighting":"flat colored light with painted shadows","photography":"2D flat camera, limited parallax","palette":["#ff6b6b","#feca57","#48dbfb","#1dd1a1"],"textures":"hand-drawn lines, flat color fills","environments":"painted backgrounds","cinematic_language":"clear silhouettes, limited animation, strong poses","prompt_modifier":"2D hand-drawn animation style, clean ink outlines, flat colors, painted backgrounds, traditional cel animation look"}$j$),
(null, 'pixar-like', 'Estilo Pixar (animação 3D familiar)', 'Personagens expressivos, luz quente, enquadramento emotivo. Inspiração genérica, sem usar personagens existentes.', $j$
{"lighting":"warm key light, soft bounce, glowing practicals","photography":"cinematic virtual camera, anamorphic feel, rich depth","palette":["#f6b93b","#e55039","#4a69bd","#78e08f"],"textures":"detailed stylized skin, soft fabrics, tactile props","environments":"cozy detailed sets","cinematic_language":"emotional close-ups, gentle push-ins, expressive acting","prompt_modifier":"family-friendly 3D animated feature film look, original characters, expressive faces, warm cinematic lighting, rich detailed sets, soft subsurface scattering"}$j$),
(null, 'anime', 'Anime', 'Animação japonesa com sombreamento cel e cenários detalhados.', $j$
{"lighting":"cel-shaded with dramatic rim light and bloom","photography":"layered anime compositing, lens flare, speed lines","palette":["#ff6b9d","#54a0ff","#feca57","#2f3542"],"textures":"cel shading, detailed painted skies","environments":"detailed urban and natural backgrounds","cinematic_language":"dynamic angles, held poses, impact frames","prompt_modifier":"anime film style, cel shading, detailed painted background, dramatic lighting, expressive eyes, crisp line art"}$j$),
(null, 'manga', 'Mangá', 'Preto e branco com retículas e traços de nanquim.', $j$
{"lighting":"high contrast ink shadows","photography":"panel-style framing, dramatic angles","palette":["#111111","#f5f5f5","#7f8c8d"],"textures":"screentone dots, ink hatching","environments":"detailed linework backgrounds","cinematic_language":"panel composition, emphasis lines, dramatic close-ups","prompt_modifier":"black and white manga illustration, ink linework, screentone shading, dramatic composition, high contrast"}$j$),
(null, 'fantasia-medieval', 'Fantasia medieval', 'Reinos, castelos, magia e criaturas.', $j$
{"lighting":"torchlight, golden hour, misty volumetric light","photography":"epic wide shots, anamorphic","palette":["#6d4c41","#c9a227","#2e4a3a","#4a3b69"],"textures":"stone, leather, chainmail, aged parchment","environments":"castles, forests, taverns, mountains","cinematic_language":"sweeping establishing shots, heroic low angles","prompt_modifier":"epic medieval fantasy film still, torchlight and volumetric mist, detailed armor and leather, castle and forest environments, anamorphic lens"}$j$),
(null, 'faroeste', 'Faroeste', 'Deserto, poeira, duelos ao entardecer.', $j$
{"lighting":"harsh midday sun, golden hour, long shadows","photography":"widescreen 2.39:1 feel, extreme close-ups on eyes","palette":["#c97b3c","#e8c07d","#6b3e26","#2f3e46"],"textures":"dust, weathered wood, worn leather","environments":"desert towns, saloons, canyons","cinematic_language":"slow zooms, extreme wide shots, tense standoffs","prompt_modifier":"classic western film still, dusty desert town, harsh sunlight with long shadows, worn leather and weathered wood, widescreen cinematic framing"}$j$),
(null, 'ficcao-cientifica', 'Ficção científica', 'Futuro limpo, tecnologia, espaço.', $j$
{"lighting":"cool LED panels, lens flares, soft ambient glow","photography":"anamorphic wide, clean symmetrical framing","palette":["#0b132b","#1c7ed6","#e9ecef","#f59f00"],"textures":"brushed metal, glass, holographic surfaces","environments":"spaceships, labs, alien landscapes","cinematic_language":"symmetry, slow tracking, scale contrasts","prompt_modifier":"science fiction film still, sleek futuristic design, cool ambient lighting, anamorphic lens flares, brushed metal and glass surfaces"}$j$),
(null, 'cyberpunk', 'Cyberpunk', 'Cidade noturna, neon, chuva e alta tecnologia decadente.', $j$
{"lighting":"neon signs, wet reflections, volumetric haze","photography":"low angles, tight lenses, rain streaks","palette":["#0d0221","#ff2a6d","#05d9e8","#d1f7ff"],"textures":"wet asphalt, chrome, holographic ads","environments":"dense neon megacity, night markets","cinematic_language":"dutch angles, tracking through crowds","prompt_modifier":"cyberpunk film still, rain-soaked neon city at night, magenta and cyan lighting, wet reflections, volumetric haze, high-tech low-life"}$j$),
(null, 'terror', 'Terror', 'Atmosfera opressiva, sombras e tensão crescente.', $j$
{"lighting":"low-key, single practical source, deep shadows","photography":"wide lenses in tight spaces, static unsettling frames","palette":["#0a0a0a","#3b1f1f","#5c6b5c","#bfae9a"],"textures":"peeling paint, damp walls, fog","environments":"abandoned houses, forests at night","cinematic_language":"slow pushes, negative space, long held shots","prompt_modifier":"horror film still, low-key lighting, deep shadows, desaturated colors, oppressive atmosphere, fog, unsettling composition"}$j$),
(null, 'suspense', 'Suspense', 'Thriller psicológico, tensão contida.', $j$
{"lighting":"chiaroscuro, blinds and window shadows","photography":"controlled framing, voyeuristic long lenses","palette":["#1b1b1b","#4f6d7a","#c0b283","#7a0c0c"],"textures":"rain on glass, cigarette smoke, worn leather","environments":"offices at night, empty streets, motels","cinematic_language":"slow dolly, reflections, off-center framing","prompt_modifier":"psychological thriller film still, chiaroscuro lighting, muted cool palette, tense composition, shallow depth of field"}$j$),
(null, 'filme-historico', 'Filmes históricos', 'Épocas passadas com figurino e direção de arte fiéis.', $j$
{"lighting":"candlelight, overcast daylight, painterly","photography":"classic composition, 35mm film look","palette":["#5a4632","#a68a64","#2f3a45","#8b2d2d"],"textures":"period fabrics, hand-forged metal, aged paper","environments":"period interiors, streets, battlefields","cinematic_language":"measured camera, painterly compositions","prompt_modifier":"historical period drama film still, authentic period costumes and set design, painterly natural lighting, 35mm film look"}$j$),
(null, 'super-herois', 'Super-heróis', 'Ação em larga escala, trajes e poderes. Apenas heróis originais.', $j$
{"lighting":"high contrast with colored rim lights, energy glows","photography":"low heroic angles, dynamic wide lenses","palette":["#e63946","#1d3557","#ffb703","#f1faee"],"textures":"high-tech suits, debris, energy effects","environments":"city skylines, rooftops, battle zones","cinematic_language":"hero shots, slow-motion impacts, dynamic tracking","prompt_modifier":"blockbuster superhero film still, original hero design, dramatic rim lighting, dynamic low-angle composition, energy effects, city environment"}$j$),
(null, 'contos-de-fadas', 'Contos de fadas', 'Mundo encantado, ilustração de livro de histórias.', $j$
{"lighting":"soft magical glow, dappled forest light","photography":"storybook compositions, gentle depth","palette":["#f8c8dc","#b5ead7","#c7ceea","#ffdac1"],"textures":"watercolor washes, embroidered fabric, moss","environments":"enchanted forests, cottages, towers","cinematic_language":"gentle pans, whimsical framing","prompt_modifier":"fairy tale storybook illustration style, soft magical lighting, watercolor textures, enchanted forest, whimsical and warm"}$j$),
(null, 'stop-motion', 'Stop Motion', 'Bonecos e miniaturas com movimento quadro a quadro.', $j$
{"lighting":"miniature set lighting with warm practical lamps","photography":"macro lens, shallow focus, tactile frame stutter","palette":["#b5651d","#6b705c","#a5a58d","#cb997e"],"textures":"visible fingerprints, felt, clay, wood, wire","environments":"handmade miniature sets","cinematic_language":"deliberate camera, held poses, charming imperfections","prompt_modifier":"stop-motion animation look, handmade puppets and miniature sets, visible material textures like felt and clay, warm tabletop lighting, macro lens"}$j$),
(null, 'massinha-3d', 'Massinha 3D', 'Personagens de massa de modelar, acabamento artesanal.', $j$
{"lighting":"bright soft studio light","photography":"macro-like close framing, shallow focus","palette":["#ff6b6b","#4ecdc4","#ffe66d","#a29bfe"],"textures":"modeling clay, thumbprints, matte plasticine","environments":"colorful clay sets","cinematic_language":"playful framing, bouncy motion","prompt_modifier":"claymation plasticine characters, visible thumbprints and clay texture, bright soft studio lighting, colorful handmade clay set, macro lens"}$j$),
(null, 'documentario', 'Documentário', 'Observacional, luz disponível, câmera na mão.', $j$
{"lighting":"available light, mixed color temperatures","photography":"handheld, 24-70mm zoom feel, grab-the-moment framing","palette":["#3d3d3d","#8c7a5b","#5b7c8d","#d9d4c7"],"textures":"real locations, natural imperfections","environments":"real-world locations","cinematic_language":"observational handheld, interview framing, B-roll","prompt_modifier":"documentary film still, handheld camera feel, available natural light, candid realistic moment, slight grain"}$j$),
(null, 'hollywood', 'Cinematográfico Hollywood', 'Superprodução com iluminação polida e composição épica.', $j$
{"lighting":"polished three-point lighting, teal-and-orange grade","photography":"anamorphic 2.39:1, shallow depth, lens flares","palette":["#0f4c5c","#e36414","#fb8b24","#1b1b1e"],"textures":"high production value, pristine detail","environments":"large-scale sets and locations","cinematic_language":"crane and dolly moves, hero close-ups, epic wides","prompt_modifier":"Hollywood blockbuster cinematography, anamorphic widescreen, teal and orange color grade, polished lighting, epic composition, high production value"}$j$),
(null, 'infantil', 'Infantil', 'Colorido, amigável e seguro para crianças.', $j$
{"lighting":"bright, even and cheerful","photography":"simple clear framing, eye-level camera","palette":["#ff6b6b","#feca57","#48dbfb","#1dd1a1"],"textures":"rounded shapes, soft felt, glossy toys","environments":"playgrounds, bedrooms, gardens","cinematic_language":"slow clear action, bouncy rhythm","prompt_modifier":"children's animation style, bright cheerful colors, rounded friendly shapes, simple clear composition, soft lighting, child-safe and gentle mood"}$j$)
on conflict do nothing;
