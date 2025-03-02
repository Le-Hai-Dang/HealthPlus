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

// Thêm các STUN/TURN servers bổ sung
const ICE_SERVERS = {
    'iceServers': [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: 'turn:a.relay.metered.ca:80',
            username: 'your_username',  // Đăng ký tại metered.ca để lấy credentials
            credential: 'your_credential'
        },
        {
            urls: 'turn:a.relay.metered.ca:443',
            username: 'your_username',
            credential: 'your_credential'
        },
        {
            urls: 'turn:a.relay.metered.ca:443?transport=tcp',
            username: 'your_username',
            credential: 'your_credential'
        }
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'relay' // Bắt buộc sử dụng TURN server
};

const mediaConstraints = {
    video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15 }
    },
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    }
};

async function initializePeer() {
    console.log("Initializing peer...");
    
    // Đóng kết nối cũ nếu có
    if (peer) {
        peer.destroy();
    }
    
    if (isAdmin) {
        peer = new Peer(ADMIN_CREDENTIALS.peerId, {
            host: '0.peerjs.com',
            port: 443,
            secure: true,
            debug: 3, // Thêm debug để theo dõi lỗi
            config: ICE_SERVERS
        });
    } else {
        peer = new Peer({
            host: '0.peerjs.com', 
            port: 443,
            secure: true,
            debug: 3,
            config: ICE_SERVERS
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
                if (currentCall) {
                    console.log('Đã có cuộc gọi, thêm vào hàng đợi:', call.peer);
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

                console.log('Admin nhận cuộc gọi mới');
                currentUserId = call.peer;
            }

            // Khởi tạo local stream cho cả admin và user
            console.log('Khởi tạo local stream...');
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            console.log('Đã có local stream, hiển thị video local');
            const localVideo = document.getElementById('local-video');
            localVideo.srcObject = localStream;
            await localVideo.play().catch(e => console.error('Lỗi khi play local video:', e));

            console.log('Trả lời cuộc gọi với local stream');
            call.answer(localStream);
            handleCall(call);
        } catch (err) {
            console.error('Lỗi khi xử lý cuộc gọi đến:', err);
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
    if (!peerId) {
        peerId = document.getElementById('peer-id-input').value;
    }
    
    if (!peerId) {
        alert('Vui lòng nhập Peer ID');
        return;
    }

    try {
        const ICE_TIMEOUT = 15000; // 15 giây timeout cho ICE connection
        
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        document.getElementById('local-video').srcObject = localStream;
        
        if (peer && peer.connected) {
            const call = peer.call(peerId, localStream);
            
            // Thêm promise timeout cho ICE connection
            const iceConnected = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('ICE Connection timeout'));
                }, ICE_TIMEOUT);
                
                call.peerConnection.oniceconnectionstatechange = () => {
                    if (call.peerConnection.iceConnectionState === 'connected') {
                        clearTimeout(timeout);
                        resolve();
                    }
                };
            });
            
            await iceConnected;
            handleCall(call);
            
        } else {
            throw new Error('Chưa kết nối tới server');
        }
    } catch (err) {
        console.error('Lỗi khi kết nối:', err);
        alert('Lỗi: ' + err.message);
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
    }
}

function handleCall(call) {
    currentCall = call;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3;
    
    // Theo dõi trạng thái kết nối ICE
    call.peerConnection.oniceconnectionstatechange = () => {
        const state = call.peerConnection.iceConnectionState;
        console.log('Trạng thái ICE:', state);
        
        if (state === 'failed' || state === 'disconnected') {
            console.log(`Lần thử kết nối lại thứ ${reconnectAttempts + 1}`);
            
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                // Thử kết nối lại ngay lập tức
                call.peerConnection.restartIce();
                
                // Kiểm tra sau 5 giây
                setTimeout(() => {
                    if (call.peerConnection.iceConnectionState !== 'connected') {
                        if (reconnectAttempts === MAX_RECONNECT_ATTEMPTS) {
                            console.log('Đã hết số lần thử lại');
                            endCall();
                            if (!isAdmin) {
                                setTimeout(quickConnect, 2000);
                            }
                        }
                    }
                }, 5000);
            }
        } else if (state === 'connected') {
            console.log('Kết nối ICE thành công');
            reconnectAttempts = 0;
        }
    };

    // Xử lý remote stream với timeout
    const streamTimeout = setTimeout(() => {
        if (!document.getElementById('remote-video').srcObject) {
            console.error('Không nhận được stream sau 10 giây');
            endCall();
        }
    }, 10000);

    call.on('stream', (remoteStream) => {
        clearTimeout(streamTimeout);
        console.log('Nhận được remote stream');
        const remoteVideo = document.getElementById('remote-video');
        
        try {
            remoteVideo.srcObject = null;
            remoteVideo.load();
            remoteVideo.srcObject = remoteStream;
            remoteVideo.play()
                .then(() => console.log('Remote video đang phát'))
                .catch(e => {
                    console.error('Lỗi khi play remote video:', e);
                    setTimeout(() => remoteVideo.play(), 1000);
                });
        } catch (err) {
            console.error('Lỗi khi xử lý remote stream:', err);
        }
    });

    // Xử lý lỗi cuộc gọi
    call.on('error', (err) => {
        console.error('Lỗi trong cuộc gọi:', err);
        clearTimeout(streamTimeout);
        endCall();
    });

    // Cập nhật UI
    document.getElementById('setup-box').classList.add('hidden');
    document.getElementById('call-box').classList.remove('hidden');
    updateControlButtons();
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
    // Dọn dẹp cuộc gọi hiện tại
    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }
    
    // Dừng và dọn dẹp stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            localStream.removeTrack(track);
        });
        localStream = null;
    }
    
    // Reset video elements
    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    
    if (localVideo.srcObject) {
        localVideo.srcObject = null;
        localVideo.load();
    }
    
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
        remoteVideo.load();
    }
    
    // Cập nhật UI
    document.getElementById('call-box').classList.add('hidden');
    document.getElementById('setup-box').classList.remove('hidden');
    
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
        // Dọn dẹp tài nguyên cũ
        if (localStream) {
            localStream.getTracks().forEach(track => {
                track.stop();
                localStream.removeTrack(track);
            });
            localStream = null;
        }
        
        // Khởi tạo stream mới với retry
        let retryCount = 0;
        const MAX_RETRIES = 3;
        
        while (retryCount < MAX_RETRIES && !localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 320 },
                        height: { ideal: 240 },
                        frameRate: { ideal: 15 }
                    },
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                break;
            } catch (err) {
                retryCount++;
                console.error(`Lỗi khởi tạo stream lần ${retryCount}:`, err);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (!localStream) {
            throw new Error('Không thể khởi tạo stream sau nhiều lần thử');
        }

        // Thông báo cho user được gọi
        conn.send({ type: 'called' });

        // Hiển thị local video
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        await localVideo.play().catch(e => console.error('Lỗi khi play local video:', e));

        // Đóng cuộc gọi cũ
        if (currentCall) {
            currentCall.close();
            currentCall = null;
        }

        // Tạo cuộc gọi mới với timeout
        if (peer && peer.connected) {
            console.log('Bắt đầu gọi tới:', peerId);
            const call = peer.call(peerId, localStream);
            
            // Xử lý timeout cho việc thiết lập kết nối
            const connectionTimeout = setTimeout(() => {
                if (!currentCall || !document.getElementById('remote-video').srcObject) {
                    console.error('Timeout: Không thể thiết lập kết nối video');
                    endCall();
                    if (!isAdmin) {
                        setTimeout(quickConnect, 2000);
                    }
                }
            }, 20000);

            call.on('stream', (remoteStream) => {
                clearTimeout(connectionTimeout);
                handleRemoteStream(remoteStream, peerId);
            });

            currentCall = call;
            currentUserId = peerId;
        }
    } catch (err) {
        console.error('Lỗi trong startNewCall:', err);
        alert('Không thể kết nối: ' + err.message);
    }
}

function handleRemoteStream(remoteStream, peerId) {
    console.log('Xử lý remote stream từ:', peerId);
    const remoteVideo = document.getElementById('remote-video');
    remoteVideo.srcObject = remoteStream;
    remoteVideo.play().catch(e => console.error('Lỗi khi play remote video:', e));
    
    document.getElementById('setup-box').classList.add('hidden');
    document.getElementById('call-box').classList.remove('hidden');
    updateControlButtons();
    showNextPatientButton();
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