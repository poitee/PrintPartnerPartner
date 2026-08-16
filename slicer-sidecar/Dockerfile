# OrcaSlicer headless slicing sidecar.
#
# Reuses the linuxserver/orcaslicer image (has orca-slicer CLI + bundled
# printer/process/filament profiles baked in under /opt/orcaslicer/resources)
# but replaces the s6/Selkies GUI entrypoint with a plain Flask HTTP server
# that drives the CLI directly. No Xvfb/X11/GUI needed for CLI slicing.
FROM lscr.io/linuxserver/orcaslicer:latest

RUN /lsiopy/bin/pip3 install --no-cache-dir flask==3.1.3

COPY sidecar.py /opt/sidecar/sidecar.py

ENV SLICER_KIND=orca \
    SLICER_BIN=/opt/orcaslicer/bin/orca-slicer \
    SIDECAR_WORKDIR=/tmp/sidecar-jobs \
    PORT=2814

EXPOSE 2814

ENTRYPOINT ["/lsiopy/bin/python3", "/opt/sidecar/sidecar.py"]
