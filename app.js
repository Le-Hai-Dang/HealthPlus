let peer = null;
let currentCall = null;
let localStream = null;
let isCameraOn = true;
let isMicOn = true;

// Thêm biến để lưu trữ thông tin admin
const ADMIN_CREDENTIALS = {
    username: 'admin',
    password: '123456',
    peerId: 'doctor123'
};

let isAdmin = false;
let adminPeerId = null;

async function initializePeer() {
    console.log("Initializing peer...");
    
    if (isAdmin) {
        // Nếu là admin, sử dụng peerId cố định
        peer = new Peer(ADMIN_CREDENTIALS.peerId, {
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
    } else {
        // Nếu là user thường, để PeerJS tự tạo ID
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
    }
    
    peer.on('open', (id) => {
        console.log("Peer ID của tôi là:", id);
        document.getElementById('my-peer-id').textContent = id;
        peer.connected = true;
        if (isAdmin) {
            adminPeerId = id;
            localStorage.setItem('adminPeerId', id);
        }
    });

    peer.on('error', (error) => {
        console.error('Lỗi PeerJS:', error);
        document.getElementById('my-peer-id').textContent = 'Lỗi kết nối: ' + error.type;
        peer.connected = false;
    });

    peer.on('disconnected', () => {
        console.log('Mất kết nối với server');
        peer.connected = false;
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
            
            // Nếu là admin, tự động trả lời cuộc gọi
            if (isAdmin) {
                console.log('Admin tự động trả lời cuộc gọi');
                document.getElementById('local-video').srcObject = localStream;
                call.answer(localStream);
                handleCall(call);
            } else {
                // Nếu là user thường, hiện hộp thoại xác nhận
                if (confirm('Bạn có muốn trả lời cuộc gọi?')) {
                    document.getElementById('local-video').srcObject = localStream;
                    call.answer(localStream);
                    handleCall(call);
                } else {
                    localStream.getTracks().forEach(track => track.stop());
                }
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

    if (!peer || !peer.connected) {
        alert('Đang kết nối lại...');
        await initializePeer();
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
        
        // Đảm bảo peer đã được khởi tạo và kết nối
        if (peer && peer.connected) {
            const call = peer.call(peerId, localStream);
            if (call) {
                console.log('Đã gọi tới peer:', peerId);
                handleCall(call);
            } else {
                throw new Error('Không thể tạo cuộc gọi');
            }
        } else {
            throw new Error('Chưa kết nối tới server');
        }
    } catch (err) {
        console.error('Lỗi khi kết nối:', err);
        alert('Lỗi: ' + err.message);
        // Dọn dẹp stream nếu có lỗi
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
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

// Thêm hàm toggleLoginForm
function toggleLoginForm() {
    const loginBox = document.getElementById('login-box');
    
    if (loginBox.classList.contains('hidden')) {
        // Hiện form login và thêm overlay
        loginBox.classList.remove('hidden');
        if (!document.querySelector('.overlay')) {
            document.body.insertAdjacentHTML('beforeend', '<div class="overlay"></div>');
            document.querySelector('.overlay').addEventListener('click', toggleLoginForm);
        }
    } else {
        // Ẩn form login và xóa overlay
        loginBox.classList.add('hidden');
        const overlay = document.querySelector('.overlay');
        if (overlay) {
            overlay.remove();
        }
    }
}

// Sửa lại hàm login
function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        isAdmin = true;
        toggleLoginForm(); // Ẩn form login
        document.getElementById('setup-box').classList.remove('hidden');
        document.querySelector('#setup-box h2').textContent = 'Chào mừng Bác sĩ';
        document.getElementById('login-button').textContent = 'Bác sĩ đã đăng nhập';
        document.getElementById('login-button').disabled = true;
        initializePeer();
    } else if (username && password) {
        isAdmin = false;
        toggleLoginForm(); // Ẩn form login
        document.getElementById('setup-box').classList.remove('hidden');
        document.querySelector('#setup-box h2').textContent = 'Kết nối với Bác sĩ';
        document.getElementById('login-button').textContent = 'Đã đăng nhập';
        document.getElementById('login-button').disabled = true;
        initializePeer();
    } else {
        alert('Vui lòng nhập đầy đủ thông tin đăng nhập!');
    }
}

// Sửa lại hàm quickConnect để không hiện thông báo "đang kết nối lại"
async function quickConnect() {
    const adminId = ADMIN_CREDENTIALS.peerId; // Sử dụng peerId cố định
    if (adminId) {
        console.log('Kết nối nhanh với bác sĩ ID:', adminId);
        
        // Kiểm tra kết nối ngầm
        if (!peer || !peer.connected) {
            await initializePeer();
        }
        
        // Thực hiện kết nối
        try {
            console.log('Đang kết nối tới bác sĩ:', adminId);
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            document.getElementById('local-video').srcObject = localStream;
            const call = peer.call(adminId, localStream);
            if (call) {
                console.log('Đã gọi tới bác sĩ');
                handleCall(call);
            }
        } catch (err) {
            console.error('Lỗi khi kết nối:', err);
            alert('Lỗi: ' + err.message);
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
        }
    } else {
        alert('Không tìm thấy bác sĩ trực tuyến, vui lòng thử lại sau');
    }
}

// Thêm vào cuối file
window.onload = function() {
    document.getElementById('setup-box').classList.remove('hidden');
    if (!isAdmin) {
        initializePeer();
    }
}