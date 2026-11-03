"""Generate an experimental SVG draft for the exact supplied 111.vsdx only.

Usage: python tests-manual/run-reference-candidate.py INPUT.vsdx OUTPUT_DIRECTORY
Requires Windows Pillow EMF support, OpenCV and Node.js. This fixture-specific
experiment uses hand-selected templates, inferred groupings and provisional
routes; its output is not approved or suitable for building a rack. Existing
output files are never overwritten. The finished reference is not read.
"""
import hashlib
from contextlib import contextmanager
import secrets
import io
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from PIL import Image

EXPECTED_INPUT = '1c0359ebfc03eafac313c55939368769e0ac1fadc7f4587085b74c91027fbf8d'
EXPECTED_EMF = 'b7a44605bb41d8ce240d0125068bc7e922cca3d6204ff4b57c71d176fb6905d6'
HERE = Path(__file__).resolve().parent


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


@contextmanager
def scratch_directory(parent):
    # Create a unique workspace directory; delete only files this tool creates.
    work = parent / ('wireflow-fixture-' + secrets.token_hex(12))
    work.mkdir()
    try:
        yield work
    finally:
        for name in ('rack.png', 'rack-3x.png', 'faces.json', 'modules.json', 'devices.json', 'rack.svg', 'sheet.svg'):
            target = work / name
            if target.is_file():
                target.unlink()
        work.rmdir()


def generate(source, outdir):
    source = source.resolve()
    if sha256_file(source) != EXPECTED_INPUT:
        raise ValueError('This experimental pipeline only accepts the exact tested 111.vsdx; no output was created.')
    outdir.mkdir(parents=True, exist_ok=True)
    outdir = outdir.resolve()
    outputs = [outdir / 'EXPERIMENTAL-rack-DO-NOT-BUILD.svg', outdir / 'EXPERIMENTAL-A3-DO-NOT-BUILD.svg']
    if any(p.exists() for p in outputs):
        raise FileExistsError('An output file already exists. Choose an empty output directory; nothing was overwritten.')
    with zipfile.ZipFile(source) as archive:
        emf = archive.read('visio/media/image1.emf')
    if hashlib.sha256(emf).hexdigest() != EXPECTED_EMF:
        raise ValueError('The embedded rack image is not the tested image.')
    with scratch_directory(outdir) as tmp:
        tmp = Path(tmp)
        low, high = tmp/'rack.png', tmp/'rack-3x.png'
        with Image.open(io.BytesIO(emf)) as image:
            image.load()
            if image.size != (1155, 428):
                raise ValueError('Unexpected raster size; candidate templates do not apply.')
            image.convert('RGB').save(low)
        with Image.open(io.BytesIO(emf)) as image:
            dpi = image._inch
            image.load(dpi=(dpi[0]*3, dpi[1]*3))
            if image.size != (3465, 1283):
                raise ValueError('Unexpected high-resolution raster size; candidate templates do not apply.')
            image.convert('RGB').save(high)
        faces, modules, devices = tmp/'faces.json', tmp/'modules.json', tmp/'devices.json'
        commands = [
            [sys.executable, str(HERE/'reference-module-candidates.py'), str(low), str(faces)],
            [sys.executable, str(HERE/'reference-port-candidates.py'), str(high), str(faces), str(modules)],
            [sys.executable, str(HERE/'reference-device-candidates.py'), str(low), str(high), str(devices)],
            ['node', str(HERE/'reference-candidate-draft.js'), str(low), str(modules), str(devices), str(tmp/'rack.svg'), str(tmp/'sheet.svg')],
        ]
        for command in commands:
            subprocess.run(command, check=True)
        # Verify the actual newly generated SVG and candidates before exposing
        # outputs. This checks positions, not cable suitability or clearance.
        validation_env = os.environ.copy()
        validation_env.update(WIREFLOW_CANDIDATE_SVG=str(tmp/'rack.svg'),
                              WIREFLOW_CANDIDATE_MODULES=str(modules),
                              WIREFLOW_CANDIDATE_DEVICES=str(devices))
        if not all(p.is_file() for p in (tmp/'rack.svg', modules, devices)):
            raise ValueError('The generator did not produce all files required for endpoint checks.')
        subprocess.run([sys.executable, str(HERE/'test-reference-candidate-endpoints.py')],
                       check=True, env=validation_env)
        for src, dst in zip((tmp/'rack.svg', tmp/'sheet.svg'), outputs):
            with src.open('rb') as inp, dst.open('xb') as out:
                shutil.copyfileobj(inp, out)
    return outputs


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    try:
        outputs = generate(Path(sys.argv[1]), Path(sys.argv[2]))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        sys.exit('Experimental draft not generated: ' + str(error))
    print('EXPERIMENTAL ONLY — do not build from these files:')
    for output in outputs:
        print(output)
