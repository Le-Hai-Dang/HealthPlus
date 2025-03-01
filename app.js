let peer = null;
let currentCall = null;
let localStream = null;
let isCameraOn = true;
let isMicOn = true;
let waitingQueue = [];
let currentUserId = null;

// Thêm biến để lưu trữ thông tin admin
const ADMIN_CREDENTIALS = {
    username: 'admin',
    password: '123456',
    peerId: 'doctor123'
};

let isAdmin = false;
let adminPeerId = null;

// Thêm biến để theo dõi trạng thái kết nối ICE
let iceConnectionTimeout;

async function initializePeer() {
    console.log("Initializing peer...");
    
    // Đóng kết nối cũ nếu có
    if (peer) {
        peer.destroy();
        // Đợi một chút để đảm bảo kết nối cũ được đóng hoàn toàn
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    const peerConfig = {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 3,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        }
    };

    if (isAdmin) {
        peer = new Peer(ADMIN_CREDENTIALS.peerId, peerConfig);
    } else {
        peer = new Peer(peerConfig);
    }

    peer.on('open', (id) => {
        console.log("Peer ID của tôi là:", id);
        document.getElementById('my-peer-id').textContent = id;
        peer.connected = true;
        if (isAdmin) {
            adminPeerId = id;
            localStorage.setItem('adminPeerId', id);
        }
        updateControlButtons();
    });

    peer.on('error', (error) => {
        console.error('Lỗi PeerJS:', error);
        if (error.type === 'peer-unavailable') {
            // Thử khởi tạo lại kết nối
            setTimeout(initializePeer, 5000);
        }
    });

    peer.on('disconnected', () => {
        console.log('Mất kết nối với server');
        peer.connected = false;
        // Thử kết nối lại sau 5 giây
        setTimeout(() => {
            peer.reconnect();
        }, 5000);
    });

    peer.on('call', async (call) => {
        console.log('Có cuộc gọi đến từ:', call.peer);
        
        try {
            if (isAdmin) {
                // Nếu đang có cuộc gọi
                if (currentCall) {
                    waitingQueue.push(call.peer);
                    const conn = peer.connect(call.peer);
                    conn.on('open', () => {
                        conn.send({
                            type: 'waiting',
                            position: waitingQueue.length
                        });
                    });
                    call.close();
                    showNextPatientButton();
                    return;
                }

                currentUserId = call.peer;
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                
                document.getElementById('local-video').srcObject = localStream;
                call.answer(localStream);
                handleCall(call);
            } else {
                // Chỉ khởi tạo stream khi được bác sĩ gọi
                document.getElementById('call-box').classList.remove('hidden');
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                document.getElementById('local-video').srcObject = localStream;
                call.answer(localStream);
                handleCall(call);
            }
        } catch (err) {
            console.error('Lỗi khi truy cập media:', err);
            alert('Không thể truy cập camera hoặc microphone: ' + err.message);
        }
    });

    // Thêm xử lý sự kiện connection
    peer.on('connection', (conn) => {
        conn.on('data', (data) => {
            if (data.type === 'waiting') {
                document.getElementById('waiting-box').classList.remove('hidden');
                document.getElementById('setup-box').classList.add('hidden');
                document.getElementById('call-box').classList.add('hidden');
                document.getElementById('queue-position').textContent = data.position;
            } else if (data.type === 'called') {
                document.getElementById('waiting-box').classList.add('hidden');
                document.getElementById('call-box').classList.remove('hidden');
            } else if (data.type === 'queue_update' && isAdmin) {
                waitingQueue = data.queue;
                showNextPatientButton();
                // Thêm log để debug
                console.log('Hàng đợi đã được cập nhật:', waitingQueue);
            }
        });
    });
}

async function connectToPeer(peerId) {
    // Nếu không có peerId được truyền vào, lấy từ input
    if (!peerId) {
        peerId = document.getElementById('peer-id-input').value;
    }
    
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
    updateControlButtons();

    // Thêm xử lý ICE connection state
    call.peerConnection.oniceconnectionstatechange = () => {
        const state = call.peerConnection.iceConnectionState;
        console.log('ICE connection state changed:', state);
        
        clearTimeout(iceConnectionTimeout);
        
        if (state === 'disconnected' || state === 'failed') {
            iceConnectionTimeout = setTimeout(async () => {
                console.log('ICE connection timeout, trying to reconnect...');
                try {
                    // Đóng kết nối cũ
                    if (currentCall) {
                        currentCall.close();
                    }
                    if (localStream) {
                        localStream.getTracks().forEach(track => track.stop());
                    }
                    
                    // Khởi tạo lại peer connection
                    await initializePeer();
                    
                    // Thử kết nối lại
                    if (isAdmin && waitingQueue.length > 0) {
                        nextPatient();
                    } else if (!isAdmin) {
                        quickConnect();
                    }
                } catch (err) {
                    console.error('Lỗi khi thử kết nối lại:', err);
                }
            }, 5000); // Đợi 5 giây trước khi thử kết nối lại
        }
    };

    call.on('stream', (remoteStream) => {
        document.getElementById('remote-video').srcObject = remoteStream;
    });

    call.on('close', () => {
        clearTimeout(iceConnectionTimeout);
        endCall();
    });

    if (isAdmin) {
        showNextPatientButton();
    }
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
    
    currentUserId = null;
    showNextPatientButton();
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
        // Ẩn nút kết nối với bác sĩ
        document.getElementById('quick-connect').classList.add('hidden');
        initializePeer();
    } else if (username && password) {
        isAdmin = false;
        toggleLoginForm(); // Ẩn form login
        document.getElementById('setup-box').classList.remove('hidden');
        document.querySelector('#setup-box h2').textContent = 'Kết nối với Bác sĩ';
        document.getElementById('login-button').textContent = 'Đã đăng nhập';
        document.getElementById('login-button').disabled = true;
        // Hiển thị nút kết nối với bác sĩ
        document.getElementById('quick-connect').classList.remove('hidden');
        initializePeer();
    } else {
        alert('Vui lòng nhập đầy đủ thông tin đăng nhập!');
    }
}

// Sửa lại hàm quickConnect để không hiện thông báo "đang kết nối lại"
async function quickConnect() {
    const adminId = ADMIN_CREDENTIALS.peerId;
    if (adminId) {
        try {
            console.log('Kết nối nhanh với bác sĩ ID:', adminId);
            
            if (!peer || !peer.connected) {
                await initializePeer();
            }
            
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
            
            // Xử lý khi cuộc gọi bị đóng ngay lập tức (do bác sĩ đang bận)
            call.on('close', () => {
                if (!document.getElementById('waiting-box').classList.contains('hidden')) {
                    // Nếu đang ở trạng thái chờ thì không làm gì
                    return;
                }
                // Nếu không phải do waiting box, reset lại giao diện
                document.getElementById('local-video').srcObject = null;
                localStream.getTracks().forEach(track => track.stop());
            });

            handleCall(call);
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

function cancelWaiting() {
    // Kiểm tra xem user có trong hàng đợi không
    const myPeerId = peer.id;
    const index = waitingQueue.indexOf(myPeerId);
    
    if (index > -1) {
        // Xóa khỏi hàng đợi
        waitingQueue.splice(index, 1);
        
        // Thông báo cho admin về việc cập nhật hàng đợi
        if (ADMIN_CREDENTIALS.peerId) {
            const adminConn = peer.connect(ADMIN_CREDENTIALS.peerId);
            adminConn.on('open', () => {
                adminConn.send({
                    type: 'queue_update',
                    queue: waitingQueue
                });
            });
        }
        
        // Cập nhật vị trí cho các user còn lại
        waitingQueue.forEach((peerId, newIndex) => {
            const conn = peer.connect(peerId);
            conn.on('open', () => {
                conn.send({
                    type: 'waiting',
                    position: newIndex + 1
                });
            });
        });
    }
    
    // Reset UI cho user hiện tại
    document.getElementById('waiting-box').classList.add('hidden');
    document.getElementById('setup-box').classList.remove('hidden');
}

function showNextPatientButton() {
    const nextPatientBtn = document.getElementById('next-patient-btn');
    if (isAdmin && currentCall) {
        if (waitingQueue.length > 0) {
            nextPatientBtn.classList.remove('hidden');
            nextPatientBtn.textContent = `Bệnh nhân tiếp theo (${waitingQueue.length})`;
        } else {
            nextPatientBtn.classList.add('hidden');
        }
    } else {
        nextPatientBtn.classList.add('hidden');
    }
}

// Thêm hàm mới để đồng bộ hàng đợi
function syncWaitingQueue(removedPeerId) {
    // Xóa user đã ngắt kết nối khỏi hàng đợi
    const index = waitingQueue.indexOf(removedPeerId);
    if (index > -1) {
        waitingQueue.splice(index, 1);
        
        // Cập nhật vị trí cho các user còn lại trong hàng đợi
        waitingQueue.forEach((peerId, newIndex) => {
            const conn = peer.connect(peerId);
            conn.on('open', () => {
                conn.send({
                    type: 'waiting',
                    position: newIndex + 1
                });
            });
        });

        // Cập nhật UI cho admin nếu còn user trong hàng đợi
        if (isAdmin) {
            if (waitingQueue.length > 0) {
                const nextBtn = document.getElementById('next-patient-btn');
                nextBtn.classList.remove('hidden');
                nextBtn.textContent = `Gọi bệnh nhân tiếp theo (${waitingQueue.length})`;
            } else {
                document.getElementById('next-patient-btn').classList.add('hidden');
            }
        }
    }
}

// Thêm hàm kiểm tra kết nối của tất cả user trong hàng đợi
async function checkQueueConnections() {
    const disconnectedUsers = [];
    
    // Tạo bản sao của hàng đợi để kiểm tra
    const queueToCheck = [...waitingQueue];
    
    for (let i = 0; i < queueToCheck.length; i++) {
        const peerId = queueToCheck[i];
        try {
            const conn = peer.connect(peerId);
            let isConnected = false;
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout'));
                }, 5000);

                conn.on('open', () => {
                    isConnected = true;
                    clearTimeout(timeout);
                    resolve();
                });

                conn.on('error', () => {
                    clearTimeout(timeout);
                    reject(new Error('Connection failed'));
                });
            });
        } catch (err) {
            console.log('Phát hiện user mất kết nối:', peerId);
            disconnectedUsers.push(peerId);
        }
    }
    
    // Chỉ xóa các user mất kết nối khỏi hàng đợi
    if (disconnectedUsers.length > 0) {
        waitingQueue = waitingQueue.filter(id => !disconnectedUsers.includes(id));
        
        // Cập nhật lại vị trí cho các user còn lại
        for (let i = 0; i < waitingQueue.length; i++) {
            try {
                const conn = peer.connect(waitingQueue[i]);
                conn.on('open', () => {
                    conn.send({
                        type: 'waiting',
                        position: i + 1
                    });
                });
            } catch (err) {
                console.error('Lỗi khi cập nhật vị trí:', err);
            }
        }
    }
    
    console.log('Số bệnh nhân còn lại trong hàng đợi:', waitingQueue.length);
    return waitingQueue.length;
}

// Sửa lại hàm nextPatient
async function nextPatient() {
    if (!isAdmin || waitingQueue.length === 0) return;
    
    // Kiểm tra và đồng bộ hàng đợi trước khi gọi bệnh nhân tiếp theo
    const remainingPatients = await checkQueueConnections();
    
    if (remainingPatients === 0) {
        console.log('Không còn bệnh nhân trong hàng đợi');
        document.getElementById('next-patient-btn').classList.add('hidden');
        return;
    }
    
    const nextPatientId = waitingQueue[0];
    console.log('Kiểm tra kết nối với bệnh nhân:', nextPatientId);
    
    try {
        const conn = peer.connect(nextPatientId);
        let isConnected = false;
        
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!isConnected) {
                    reject(new Error('Timeout'));
                }
            }, 5000);

            conn.on('open', () => {
                isConnected = true;
                clearTimeout(timeout);
                resolve();
            });

            conn.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        // Nếu kết nối thành công, xóa khỏi hàng đợi và bắt đầu cuộc gọi
        waitingQueue.shift();
        startNewCall(nextPatientId, conn);

    } catch (err) {
        console.error('Bệnh nhân không còn kết nối:', err);
        // Kiểm tra lại hàng đợi và thử gọi bệnh nhân tiếp theo
        await checkQueueConnections();
        if (waitingQueue.length > 0) {
            setTimeout(nextPatient, 1000);
        }
    }
}

// Thêm hàm mới để xử lý việc bắt đầu cuộc gọi mới
async function startNewCall(peerId, conn) {
    try {
        // Thông báo cho user được gọi trước
        conn.send({
            type: 'called'
        });

        // Đợi một chút để user chuẩn bị
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Khởi tạo stream mới trước khi đóng cuộc gọi cũ
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        // Sau khi có stream mới mới đóng cuộc gọi cũ
        if (currentCall) {
            currentCall.close();
            currentCall = null;
        }

        // Reset video elements
        document.getElementById('remote-video').srcObject = null;
        document.getElementById('local-video').srcObject = localStream;
        
        if (peer && peer.connected) {
            const call = peer.call(peerId, localStream);
            
            // Thêm timeout dài hơn cho việc thiết lập cuộc gọi
            const callTimeout = setTimeout(() => {
                if (!currentCall) {
                    console.error('Không thể thiết lập cuộc gọi');
                    endCall();
                }
            }, 15000);
            
            call.on('stream', (remoteStream) => {
                clearTimeout(callTimeout);
                document.getElementById('remote-video').srcObject = remoteStream;
                // Cập nhật UI sau khi nhận được stream
                document.getElementById('setup-box').classList.add('hidden');
                document.getElementById('call-box').classList.remove('hidden');
                updateControlButtons();
                showNextPatientButton();
            });
            
            call.on('close', () => {
                console.log('Cuộc gọi kết thúc');
                clearTimeout(callTimeout);
            });
            
            currentCall = call;
            currentUserId = peerId;
        }
    } catch (err) {
        console.error('Lỗi khi bắt đầu cuộc gọi mới:', err);
        // Không gọi endCall() ngay mà thử lại
        if (waitingQueue.length > 0) {
            setTimeout(nextPatient, 1000);
        }
    }
}

function returnToClinic() {
    // Ẩn nút quay lại
    document.getElementById('return-btn').classList.add('hidden');
    // Hiện nút bệnh nhân tiếp theo nếu còn bệnh nhân trong hàng đợi
    if (waitingQueue.length > 0) {
        document.getElementById('next-patient-btn').classList.remove('hidden');
        document.getElementById('next-patient-btn').textContent = `Bệnh nhân tiếp theo (${waitingQueue.length})`;
    }
    // Reset UI
    document.getElementById('setup-box').classList.add('hidden');
    document.getElementById('call-box').classList.remove('hidden');
    // Gọi bệnh nhân tiếp theo
    nextPatient();
}

// Thêm hàm mới để cập nhật hiển thị các nút điều khiển
function updateControlButtons() {
    const endCallBtn = document.getElementById('end-call-btn');
    const nextPatientBtn = document.getElementById('next-patient-btn');
    
    if (isAdmin) {
        endCallBtn.classList.remove('hidden');
        // Chỉ hiện nút next nếu có người trong hàng đợi
        if (waitingQueue.length > 0) {
            nextPatientBtn.classList.remove('hidden');
            nextPatientBtn.textContent = `Bệnh nhân tiếp theo (${waitingQueue.length})`;
        } else {
            nextPatientBtn.classList.add('hidden');
        }
    } else {
        endCallBtn.classList.add('hidden');
        nextPatientBtn.classList.add('hidden');
    }
}