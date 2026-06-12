#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
karaoke_video_builder.py

Version 0.1.alpha

Crée une vidéo karaoké MP4 à partir :
- d'un fichier audio MP3/WAV/etc.
- d'un fichier de sous-titres .srt ou .ass
- d'une image de fond optionnelle

Le timing vient du fichier .srt ou .ass.
Le script ne recale pas automatiquement les paroles : il rend la vidéo avec les temps déjà écrits dans les sous-titres.

Pré-requis : FFmpeg + FFprobe installés et accessibles dans le terminal.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional, Tuple

APP_VERSION = "0.1.alpha"

# -----------------------------------------------------------------------------
# Utilitaires console / FFmpeg
# -----------------------------------------------------------------------------

def run_command(cmd: list[str], *, capture: bool = False, verbose: bool = False) -> subprocess.CompletedProcess:
    """Lance une commande. Affiche une erreur lisible si FFmpeg/FFprobe échoue."""
    try:
        return subprocess.run(
            cmd,
            check=True,
            text=True,
            stdout=subprocess.PIPE if capture else None,
            stderr=subprocess.PIPE if capture else None,
        )
    except FileNotFoundError as exc:
        raise SystemExit(
            "Erreur : FFmpeg/FFprobe est introuvable. Installe FFmpeg puis relance le script."
        ) from exc
    except subprocess.CalledProcessError as exc:
        if capture or verbose:
            print(exc.stdout or "", file=sys.stderr)
            print(exc.stderr or "", file=sys.stderr)
        details = (exc.stderr or "").lower()
        if "codec not currently supported in container" in details:
            hint = "Le codec audio ne peut pas être copié dans un MP4. Utilise --audio-mode auto ou aac."
        elif "unable to open" in details and "subtitles" in details:
            hint = "Le fichier de sous-titres n'a pas pu être ouvert. Vérifie son nom et ses droits."
        elif "no space left" in details:
            hint = "Le disque ne dispose plus d'assez d'espace."
        else:
            hint = "Relance avec --verbose pour afficher les détails FFmpeg."
        raise SystemExit(f"Erreur pendant la création vidéo. {hint}") from exc


def ffprobe_duration_seconds(media_path: Path) -> float:
    """Retourne la durée du média en secondes via ffprobe."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json",
        str(media_path),
    ]
    result = run_command(cmd, capture=True)
    data = json.loads(result.stdout)
    duration = float(data["format"]["duration"])
    return duration


def ffprobe_media(media_path: Path) -> dict[str, Any]:
    """Retourne les informations utiles sur les flux et le conteneur."""
    result = run_command([
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(media_path),
    ], capture=True)
    return json.loads(result.stdout)


def audio_codec(media_path: Path) -> str:
    streams = ffprobe_media(media_path).get("streams", [])
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if not audio:
        raise SystemExit(f"Aucun flux audio trouvé dans : {media_path}")
    return str(audio.get("codec_name") or "unknown")


def ffmpeg_filter_escape_path(path: Path) -> str:
    """Échappe un chemin pour l'utiliser dans un filtre FFmpeg, y compris sous Windows."""
    p = str(path.resolve()).replace("\\", "/")
    # Important pour les chemins Windows C:/... et pour le filtre subtitles.
    p = p.replace(":", r"\:")
    p = p.replace("'", r"\'")
    p = p.replace(",", r"\,")
    p = p.replace("[", r"\[").replace("]", r"\]")
    return p


def safe_subtitle_copy(path: Path) -> Path:
    """Copie les sous-titres vers un chemin ASCII sûr pour le parseur de filtres FFmpeg."""
    suffix = path.suffix.lower() if path.suffix else ".ass"
    handle = tempfile.NamedTemporaryFile(prefix="syncrostella_subs_", suffix=suffix, delete=False)
    handle.close()
    target = Path(handle.name)
    shutil.copyfile(path, target)
    return target


def ffmpeg_escape_filter_value(value: str) -> str:
    """Échappe une valeur texte dans un filtre FFmpeg."""
    return value.replace("\\", r"\\").replace("'", r"\'")


def validate_title(value: str) -> str:
    title = re.sub(r"\s+", " ", value).strip()
    if len(title) > 200:
        raise argparse.ArgumentTypeError("Le titre est limité à 200 caractères.")
    return title


# -----------------------------------------------------------------------------
# Couleurs ASS/libass
# -----------------------------------------------------------------------------

def hex_to_ass_color(hex_color: str, alpha: str = "00") -> str:
    """
    Convertit #RRGGBB en format ASS : &HAABBGGRR
    alpha 00 = opaque, FF = transparent.
    """
    value = hex_color.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", value):
        raise argparse.ArgumentTypeError(f"Couleur invalide : {hex_color}. Utilise #RRGGBB.")
    rr = value[0:2]
    gg = value[2:4]
    bb = value[4:6]
    return f"&H{alpha}{bb}{gg}{rr}"


def validate_hex_color(value: str) -> str:
    value = value.strip()
    if re.fullmatch(r"#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?", value):
        return value if value.startswith("#") else f"#{value}"
    raise argparse.ArgumentTypeError(f"Couleur invalide : {value}. Utilise #RRGGBB.")


def bounded_int(minimum: int, maximum: int):
    def parse(value: str) -> int:
        number = int(value)
        if not minimum <= number <= maximum:
            raise argparse.ArgumentTypeError(f"Valeur attendue entre {minimum} et {maximum}.")
        return number
    return parse


def bounded_float(minimum: float, maximum: float):
    def parse(value: str) -> float:
        number = float(value)
        if not minimum <= number <= maximum:
            raise argparse.ArgumentTypeError(f"Valeur attendue entre {minimum} et {maximum}.")
        return number
    return parse


def validate_alpha(value: str) -> str:
    value = value.upper()
    if not re.fullmatch(r"[0-9A-F]{2}", value):
        raise argparse.ArgumentTypeError("Alpha ASS invalide. Utilise une valeur hexadécimale de 00 à FF.")
    return value


def validate_bitrate(value: str) -> str:
    if not re.fullmatch(r"\d{2,4}k", value.lower()):
        raise argparse.ArgumentTypeError("Débit invalide. Exemple : 192k.")
    return value.lower()


# -----------------------------------------------------------------------------
# Styles de sous-titres
# -----------------------------------------------------------------------------

def build_force_style(args: argparse.Namespace, subtitle_ext: str) -> Optional[str]:
    """
    Construit le style libass.
    Pour .ass, on peut préserver le style interne avec --keep-ass-style.
    Pour .srt, il faut forcément appliquer un style si on veut une belle vidéo.
    """
    if subtitle_ext == ".ass" and args.keep_ass_style:
        return None

    parts = [
        f"Fontname={args.font_name}",
        f"Fontsize={args.font_size}",
        f"PrimaryColour={hex_to_ass_color(args.primary_color)}",
        f"SecondaryColour={hex_to_ass_color(args.secondary_color)}",
        f"OutlineColour={hex_to_ass_color(args.outline_color)}",
        f"BackColour={hex_to_ass_color(args.back_color, alpha=args.back_alpha)}",
        f"Bold={-1 if args.bold else 0}",
        f"Italic={-1 if args.italic else 0}",
        f"Alignment={args.alignment}",
        f"MarginL={args.margin_l}",
        f"MarginR={args.margin_r}",
        f"MarginV={args.margin_v}",
        f"Outline={args.outline}",
        f"Shadow={args.shadow}",
        f"BorderStyle={3 if args.box else 1}",
        "Encoding=1",
    ]
    return ",".join(parts)


def build_subtitle_filter(subtitle_path: Path, args: argparse.Namespace) -> str:
    subtitle_ext = subtitle_path.suffix.lower()
    subtitle_file = ffmpeg_filter_escape_path(subtitle_path)

    chunks = [f"subtitles=filename='{subtitle_file}'"]

    fonts_dir = args.fonts_dir
    if args.font_file:
        font_file_parent = str(Path(args.font_file).resolve().parent)
        fonts_dir = fonts_dir or font_file_parent

    if fonts_dir:
        chunks.append(f"fontsdir='{ffmpeg_filter_escape_path(Path(fonts_dir))}'")

    force_style = build_force_style(args, subtitle_ext)
    if force_style:
        chunks.append(f"force_style='{ffmpeg_escape_filter_value(force_style)}'")

    return ":".join(chunks)


# -----------------------------------------------------------------------------
# Construction vidéo
# -----------------------------------------------------------------------------

def parse_resolution(resolution: str) -> Tuple[int, int]:
    match = re.fullmatch(r"(\d+)x(\d+)", resolution.strip().lower())
    if not match:
        raise argparse.ArgumentTypeError("Résolution invalide. Exemple : 1920x1080 ou 1080x1920")
    width, height = int(match.group(1)), int(match.group(2))
    if width < 320 or height < 240:
        raise argparse.ArgumentTypeError("Résolution trop petite.")
    return width, height


def choose_audio_mode(args: argparse.Namespace, audio: Path) -> tuple[str, str]:
    codec = audio_codec(audio)
    mode = args.audio_mode
    if mode == "auto":
        mode = "copy" if codec in {"aac", "mp3", "alac"} else "aac"
    if mode == "copy" and codec not in {"aac", "mp3", "alac"}:
        raise SystemExit(
            f"Le codec audio {codec} n'est pas compatible avec la copie vers MP4. "
            "Utilise --audio-mode auto ou aac."
        )
    return mode, codec


def preflight(args: argparse.Namespace) -> list[str]:
    """Vérifie les prérequis sans lancer l'encodage."""
    messages: list[str] = []
    for binary in ("ffmpeg", "ffprobe"):
        location = shutil.which(binary)
        if not location:
            raise SystemExit(f"{binary} est introuvable dans le PATH.")
        messages.append(f"OK {binary}: {location}")
    filters = run_command(["ffmpeg", "-hide_banner", "-filters"], capture=True).stdout
    if not re.search(r"\bsubtitles\b", filters):
        raise SystemExit("Le filtre FFmpeg subtitles/libass est indisponible.")
    messages.append("OK filtre subtitles/libass")
    if args.title and not re.search(r"\bdrawtext\b", filters):
        raise SystemExit("Le filtre FFmpeg drawtext est indisponible et le titre ne peut pas être rendu.")
    if args.title:
        messages.append("OK filtre drawtext pour le titre")
    encoders = run_command(["ffmpeg", "-hide_banner", "-encoders"], capture=True).stdout
    if "libx264" not in encoders:
        raise SystemExit("L'encodeur vidéo libx264 est indisponible.")
    messages.append("OK encodeur libx264")
    audio = Path(args.audio)
    subs = Path(args.subs)
    if not audio.is_file():
        raise SystemExit(f"Audio introuvable : {audio}")
    if not subs.is_file():
        raise SystemExit(f"Sous-titres introuvables : {subs}")
    if args.font_file and not Path(args.font_file).is_file():
        raise SystemExit(f"Police introuvable : {args.font_file}")
    if args.font_file:
        messages.append(f"OK police importée: {args.font_file}")
    mode, codec = choose_audio_mode(args, audio)
    messages.append(f"OK audio: codec {codec}, mode retenu {mode}")
    output = Path(args.output)
    parent = output.parent if output.parent != Path("") else Path(".")
    if not parent.exists():
        if args.create_output_dir:
            parent.mkdir(parents=True, exist_ok=True)
        else:
            raise SystemExit(f"Dossier de sortie absent : {parent}. Utilise --create-output-dir.")
    if output.exists() and not args.overwrite:
        raise SystemExit(f"La sortie existe déjà : {output}. Utilise --overwrite pour la remplacer.")
    messages.append(f"OK sortie: {output}")
    return messages


def build_ffmpeg_command(
    args: argparse.Namespace,
    safe_subs: Optional[Path] = None,
    title_file: Optional[Path] = None,
) -> list[str]:
    audio = Path(args.audio)
    subs = Path(args.subs)
    output = Path(args.output)

    if subs.suffix.lower() not in {".srt", ".ass", ".ssa"}:
        raise SystemExit("Le fichier de sous-titres doit être en .srt, .ass ou .ssa")

    width, height = parse_resolution(args.resolution)
    duration = ffprobe_duration_seconds(audio)

    cmd: list[str] = ["ffmpeg", "-y" if args.overwrite else "-n"]

    # Input vidéo : image de fond ou fond couleur.
    if args.background:
        bg = Path(args.background)
        if not bg.exists():
            raise SystemExit(f"Image de fond introuvable : {bg}")
        cmd += [
            "-loop", "1",
            "-framerate", str(args.fps),
            "-t", f"{duration:.3f}",
            "-i", str(bg),
        ]
        video_input_index = 0
        audio_input_index = 1
        cmd += ["-i", str(audio)]
        if args.background_fit == "cover":
            sizing = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
        else:
            sizing = (
                f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x{args.bg_color.lstrip('#')}"
            )
        if args.background_opacity < 0.999:
            color = args.bg_color.lstrip("#")
            base_video_filter = (
                f"color=c=0x{color}:s={width}x{height}:r={args.fps}:d={duration:.3f}[base];"
                f"[{video_input_index}:v]{sizing},format=rgba,"
                f"colorchannelmixer=aa={args.background_opacity}[bg];"
                f"[base][bg]overlay=shortest=1,setsar=1,format=yuv420p"
            )
        else:
            base_video_filter = f"[{video_input_index}:v]{sizing},setsar=1,format=yuv420p"
    else:
        # Le filtre color de FFmpeg accepte 0xRRGGBB plus facilement que #RRGGBB.
        color = args.bg_color.lstrip("#")
        cmd += [
            "-f", "lavfi",
            "-i", f"color=c=0x{color}:s={width}x{height}:r={args.fps}:d={duration:.3f}",
        ]
        video_input_index = 0
        audio_input_index = 1
        cmd += ["-i", str(audio)]
        base_video_filter = f"[{video_input_index}:v]format=yuv420p"

    subtitle_filter = build_subtitle_filter(safe_subs or subs, args)

    # Optionnel : assombrir très légèrement l'image pour rendre les textes plus lisibles.
    # eq=brightness négatif : -0.08 conseillé si image très lumineuse.
    filters = base_video_filter
    if abs(args.bg_brightness) > 0.0001:
        filters += f",eq=brightness={args.bg_brightness}"
    filters += f",{subtitle_filter}"
    if args.title and args.title_end > 0 and title_file:
        title_size = max(36, round(height * 0.085))
        title_path = ffmpeg_filter_escape_path(title_file)
        title_font = ""
        if args.font_file:
            title_font = f"fontfile='{ffmpeg_filter_escape_path(Path(args.font_file))}':"
        filters += (
            f",drawtext=textfile='{title_path}':reload=0:expansion=none:"
            f"{title_font}"
            f"fontcolor=white:fontsize={title_size}:"
            "x=(w-text_w)/2:y=(h-text_h)/2:"
            "borderw=4:bordercolor=black@0.85:"
            f"enable='lt(t,{args.title_end:.3f})'"
        )
    filters += "[v]"

    cmd += [
        "-filter_complex", filters,
        "-map", "[v]",
        "-map", f"{audio_input_index}:a:0",
        "-c:v", "libx264",
        "-preset", args.preset,
        "-crf", str(args.crf),
        "-pix_fmt", "yuv420p",
        "-r", str(args.fps),
        "-movflags", "+faststart",
    ]

    audio_mode, _codec = choose_audio_mode(args, audio)
    if audio_mode == "aac":
        cmd += ["-c:a", "aac", "-b:a", args.audio_bitrate]
    else:
        cmd += ["-c:a", "copy"]

    cmd += ["-shortest", str(output)]
    return cmd


def print_summary(args: argparse.Namespace) -> None:
    subs_ext = Path(args.subs).suffix.lower()
    mode = "ASS/SSA"
    if subs_ext == ".srt":
        mode = "SRT"
    print("\nRéglage vidéo karaoké")
    print("----------------------")
    print(f"Audio      : {args.audio}")
    print(f"Sous-titre : {args.subs} ({mode})")
    print(f"Sortie     : {args.output}")
    print(f"Fond       : {args.background or args.bg_color}")
    print(f"Résolution : {args.resolution} à {args.fps} fps")
    print(f"Police     : {args.font_name}, taille {args.font_size}")
    print(f"Alignement : {args.alignment} | Marge verticale : {args.margin_v}")
    print(f"Audio MP4  : {args.audio_mode}")
    print(f"Titre      : {args.title or '(aucun)'}")
    if args.title:
        print(f"Fin titre  : {args.title_end:.3f} s")
    if subs_ext == ".ass" and args.keep_ass_style:
        print("Style ASS  : conservé depuis le fichier .ass")
    else:
        print("Style      : appliqué par le script")
    print()


def run_self_test() -> None:
    """Exécute des tests de bout en bout avec des médias synthétiques."""
    with tempfile.TemporaryDirectory(prefix="syncrostella_video_test_") as directory:
        root = Path(directory)
        mp3 = root / "audio l'été.mp3"
        wav = root / "audio test.wav"
        subs = root / "paroles l'été,[ok].ass"
        output_mp3 = root / "sortie mp3.mp4"
        output_wav = root / "sortie wav.mp4"
        subs.write_text(
            "[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n\n"
            "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
            "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, "
            "Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            "Style: Default,Arial,36,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,"
            "100,100,0,0,1,2,1,2,20,20,30,1\n\n[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
            "Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\k50}Bon {\\k50}jour\n",
            encoding="utf-8",
        )
        run_command(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libmp3lame", str(mp3)], capture=True)
        run_command(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s16le", str(wav)], capture=True)
        common = [
            sys.executable, str(Path(__file__).resolve()), "--subs", str(subs),
            "--resolution", "640x360", "--fps", "24", "--preset", "ultrafast",
            "--keep-ass-style", "--title", "Titre d'essai", "--title-end", "0.4", "--overwrite",
        ]
        run_command(common + ["--audio", str(mp3), "--output", str(output_mp3), "--audio-mode", "auto"], capture=True)
        run_command(common + ["--audio", str(wav), "--output", str(output_wav), "--audio-mode", "auto"], capture=True)
        if audio_codec(output_mp3) != "mp3":
            raise SystemExit("Auto-test échoué : le MP3 compatible n'a pas été copié.")
        if audio_codec(output_wav) != "aac":
            raise SystemExit("Auto-test échoué : le WAV n'a pas été converti en AAC.")
        print("Auto-test réussi : titre, chemins complexes, MP3 copié, WAV converti en AAC.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Crée une vidéo karaoké à partir d'un audio et d'un fichier .srt ou .ass.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument("--audio", help="Fichier audio, par exemple les-mercuriens.mp3")
    parser.add_argument("--subs", help="Fichier .srt ou .ass")
    parser.add_argument("--output", default="karaoke_output.mp4", help="Fichier vidéo de sortie")
    parser.add_argument("--title", type=validate_title, default="", help="Titre affiché en grand avant le premier mot")
    parser.add_argument("--title-end", type=bounded_float(0, 86400), default=0.0, help="Instant de disparition du titre, en secondes")
    parser.add_argument("--version", action="version", version=f"%(prog)s {APP_VERSION}")

    parser.add_argument("--background", help="Image de fond optionnelle : png/jpg/webp")
    parser.add_argument("--bg-color", type=validate_hex_color, default="#071020", help="Couleur de fond si aucune image n'est fournie")
    parser.add_argument("--bg-brightness", type=bounded_float(-1, 1), default=0.0, help="Luminosité du fond, exemple -0.08")
    parser.add_argument("--background-fit", choices=["cover", "contain"], default="cover", help="Recadrage ou affichage complet de l'image")
    parser.add_argument("--background-opacity", type=bounded_float(0, 1), default=1.0, help="Opacité de l'image de fond")
    parser.add_argument("--resolution", type=parse_resolution, default="1920x1080", help="Résolution vidéo, ex : 1920x1080 ou 1080x1920")
    parser.add_argument("--fps", type=bounded_int(1, 120), default=30, help="Images par seconde")

    parser.add_argument("--font-name", default="Arial", help="Nom de police tel que vu par libass/FFmpeg")
    parser.add_argument("--font-file", help="Chemin vers un fichier .ttf/.otf. Le nom interne de la police doit correspondre à --font-name")
    parser.add_argument("--fonts-dir", help="Dossier contenant des polices .ttf/.otf")
    parser.add_argument("--font-size", type=bounded_int(8, 500), default=86, help="Taille du texte")
    parser.add_argument("--bold", action="store_true", help="Texte gras")
    parser.add_argument("--italic", action="store_true", help="Texte italique")

    parser.add_argument("--primary-color", type=validate_hex_color, default="#FFFFFF", help="Couleur principale / syllabe chantée en ASS karaoke")
    parser.add_argument("--secondary-color", type=validate_hex_color, default="#FFD84A", help="Couleur secondaire / syllabe non encore chantée en ASS karaoke")
    parser.add_argument("--outline-color", type=validate_hex_color, default="#000000", help="Couleur du contour")
    parser.add_argument("--back-color", type=validate_hex_color, default="#000000", help="Couleur de boîte/fond si --box est activé")
    parser.add_argument("--back-alpha", type=validate_alpha, default="80", help="Transparence ASS : 00 opaque, FF invisible")
    parser.add_argument("--outline", type=bounded_float(0, 30), default=4.0, help="Épaisseur du contour")
    parser.add_argument("--shadow", type=bounded_float(0, 30), default=1.5, help="Ombre du texte")
    parser.add_argument("--box", action="store_true", help="Ajoute un fond rectangulaire derrière les sous-titres")

    parser.add_argument(
        "--alignment",
        type=int,
        default=2,
        choices=range(1, 10),
        metavar="1-9",
        help=(
            "Alignement ASS : 1 bas gauche, 2 bas centre, 3 bas droite, "
            "4 milieu gauche, 5 centre, 6 milieu droite, 7 haut gauche, 8 haut centre, 9 haut droite"
        ),
    )
    parser.add_argument("--margin-l", type=bounded_int(0, 5000), default=70, help="Marge gauche")
    parser.add_argument("--margin-r", type=bounded_int(0, 5000), default=70, help="Marge droite")
    parser.add_argument("--margin-v", type=bounded_int(0, 5000), default=80, help="Marge verticale")

    parser.add_argument(
        "--keep-ass-style",
        action="store_true",
        help="Avec un fichier .ass, conserve les styles internes au lieu de les remplacer par les options du script",
    )

    parser.add_argument("--crf", type=bounded_int(0, 51), default=18, help="Qualité vidéo H.264 : plus bas = meilleur/plus lourd")
    parser.add_argument("--preset", default="medium", choices=["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"], help="Preset encodage vidéo")
    parser.add_argument("--audio-mode", choices=["auto", "copy", "aac"], default="auto", help="Auto copie les codecs compatibles et convertit les autres en AAC")
    parser.add_argument("--audio-bitrate", type=validate_bitrate, default="192k", help="Débit AAC")
    parser.add_argument("--overwrite", action="store_true", help="Autorise le remplacement du fichier de sortie")
    parser.add_argument("--create-output-dir", action="store_true", help="Crée le dossier de sortie si nécessaire")
    parser.add_argument("--check", action="store_true", help="Vérifie les prérequis sans encoder")
    parser.add_argument("--dry-run", action="store_true", help="Affiche la commande sans l'exécuter")
    parser.add_argument("--verbose", action="store_true", help="Affiche les détails FFmpeg en cas d'erreur")
    parser.add_argument("--self-test", action="store_true", help="Lance des tests synthétiques de bout en bout")
    parser.add_argument("--print-ffmpeg", action="store_true", help="Affiche la commande FFmpeg avant de l'exécuter")

    args = parser.parse_args()
    if args.self_test:
        run_self_test()
        return
    if not args.audio or not args.subs:
        parser.error("--audio et --subs sont obligatoires hors --self-test")

    # parse_resolution est utilisé comme type mais argparse garde le tuple ; on veut conserver l'affichage string.
    if isinstance(args.resolution, tuple):
        args.resolution = f"{args.resolution[0]}x{args.resolution[1]}"

    checks = preflight(args)
    if args.check:
        print("\nDiagnostic SyncroStella")
        print("-----------------------")
        print("\n".join(checks))
        return

    safe_subs = safe_subtitle_copy(Path(args.subs))
    title_file: Optional[Path] = None
    if args.title and args.title_end > 0:
        handle = tempfile.NamedTemporaryFile(prefix="syncrostella_title_", suffix=".txt", delete=False)
        title_file = Path(handle.name)
        handle.write(args.title.encode("utf-8"))
        handle.close()
    try:
        print_summary(args)
        cmd = build_ffmpeg_command(args, safe_subs, title_file)
        if args.print_ffmpeg or args.dry_run:
            print("Commande FFmpeg :")
            print(" ".join(shlex.quote(x) for x in cmd))
            print()
        if args.dry_run:
            return
        run_command(cmd, verbose=args.verbose)
        info = ffprobe_media(Path(args.output))
        duration = float(info.get("format", {}).get("duration", 0))
        size = int(info.get("format", {}).get("size", 0))
        codecs = ", ".join(
            f"{stream.get('codec_type')}={stream.get('codec_name')}"
            for stream in info.get("streams", [])
        )
        print(f"\nVidéo créée : {args.output}")
        print(f"Durée : {duration:.2f} s | Taille : {size / 1024 / 1024:.2f} Mio | {codecs}\n")
    finally:
        safe_subs.unlink(missing_ok=True)
        if title_file:
            title_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
