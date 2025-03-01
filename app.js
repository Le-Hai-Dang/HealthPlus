let peer = null;
let currentCall = null;
let localStream = null;
let isCameraOn = true;
let isMicOn = true;

async function initializePeer() {
    console.log("Initializing peer...");
    
    peer = new Peer({
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });
    
    peer.on('open', (id) => {
        console.log("Peer ID của tôi là:", id);
        document.getElementById('my-peer-id').textContent = id;
    });

    peer.on('error', (error) => {
        console.error('Lỗi PeerJS:', error);
        document.getElementById('my-peer-id').textContent = 'Lỗi kết nối: ' + error.type;
    });

    peer.on('call', async (call) => {
        console.log('Có cuộc gọi đến từ:', call.peer);
        
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            if (confirm('Bạn có muốn trả lời cuộc gọi?')) {
                document.getElementById('local-video').srcObject = localStream;
                call.answer(localStream);
                handleCall(call);
            } else {
                localStream.getTracks().forEach(track => track.stop());
            }
        } catch (err) {
            console.error('Lỗi khi truy cập media:', err);
            alert('Không thể truy cập camera hoặc microphone: ' + err.message);
        }
    });
}

async function connectToPeer() {
    const peerId = document.getElementById('peer-id-input').value;
    if (!peerId) {
        alert('Vui lòng nhập Peer ID');
        return;
    }

    try {
        console.log('Đang kết nối tới peer:', peerId);
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        document.getElementById('local-video').srcObject = localStream;
        const call = peer.call(peerId, localStream);
        console.log('Đã gọi tới peer:', peerId);
        handleCall(call);
    } catch (err) {
        console.error('Lỗi khi kết nối:', err);
        alert('Lỗi: ' + err.message);
    }
}

function handleCall(call) {
    currentCall = call;
    document.getElementById('setup-box').classList.add('hidden');
    document.getElementById('call-box').classList.remove('hidden');

    call.on('stream', (remoteStream) => {
        document.getElementById('remote-video').srcObject = remoteStream;
    });

    call.on('close', endCall);
}

function toggleCamera() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        isCameraOn = !isCameraOn;
        videoTrack.enabled = isCameraOn;
        document.getElementById('camera-btn').textContent = 
            isCameraOn ? 'Tắt Camera' : 'Bật Camera';
    }
}

function toggleMic() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        isMicOn = !isMicOn;
        audioTrack.enabled = isMicOn;
        document.getElementById('mic-btn').textContent = 
            isMicOn ? 'Tắt Mic' : 'Bật Mic';
    }
}

function endCall() {
    if (currentCall) {
        currentCall.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    document.getElementById('call-box').classList.add('hidden');
    document.getElementById('setup-box').classList.remove('hidden');
    document.getElementById('local-video').srcObject = null;
    document.getElementById('remote-video').srcObject = null;
}

// Gọi hàm khởi tạo khi trang được load
window.onload = initializePeer;