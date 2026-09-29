import os
import socket
import sys
import threading
from pathlib import Path

if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    if len(sys.argv)>1 and sys.argv[1]=='--demucs':
        from demucs.separate import main
        main(sys.argv[2:])
    else:
        sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
        import uvicorn
        from companion.server import app
        listener=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
        listener.bind(('127.0.0.1',0))
        listener.listen(128)
        server=uvicorn.Server(uvicorn.Config(app,log_level='warning'))
        def watch_parent():
            sys.stdin.buffer.read()
            server.should_exit=True
        threading.Thread(target=watch_parent,daemon=True).start()
        print(f'OPEN_WAVE_PORT={listener.getsockname()[1]}',flush=True)
        server.run(sockets=[listener])
