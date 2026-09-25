"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const jwt_1 = require("@nestjs/jwt");
const argon2 = __importStar(require("argon2"));
const crypto = __importStar(require("crypto"));
const uuid_1 = require("uuid");
const entities_1 = require("../../database/entities");
let AuthService = AuthService_1 = class AuthService {
    userRepository;
    jwtService;
    logger = new common_1.Logger(AuthService_1.name);
    constructor(userRepository, jwtService) {
        this.userRepository = userRepository;
        this.jwtService = jwtService;
    }
    async register(dto) {
        // Validate input
        if (!dto.username || !dto.email || !dto.password || !dto.cpf) {
            throw new common_1.BadRequestException('Missing required fields');
        }
        if (dto.username.length < 3 || dto.username.length > 16) {
            throw new common_1.BadRequestException('Username must be 3-16 characters');
        }
        if (dto.password.length < 8) {
            throw new common_1.BadRequestException('Password must be at least 8 characters');
        }
        // Check if user already exists
        const existingUser = await this.userRepository.findOne({
            where: [{ username: dto.username }, { email: dto.email }],
        });
        if (existingUser) {
            throw new common_1.BadRequestException('Username or email already registered');
        }
        // Hash password using argon2id
        const passwordHash = await argon2.hash(dto.password, {
            type: argon2.argon2id,
            memoryCost: 19456, // 19 MB
            timeCost: 2,
            parallelism: 1,
        });
        // Hash CPF
        const cpfHash = this.hashCpf(dto.cpf);
        // Create user
        const user = this.userRepository.create({
            username: dto.username,
            email: dto.email,
            passwordHash,
            cpfHash,
        });
        await this.userRepository.save(user);
        // Generate sessionId for first login
        const sessionId = (0, uuid_1.v4)();
        user.activeSessionId = sessionId;
        await this.userRepository.save(user);
        // Generate tokens with sessionId
        return this.generateTokens(user.id, user.username, sessionId);
    }
    async login(dto) {
        const user = await this.userRepository.findOne({
            where: { username: dto.username },
        });
        if (!user) {
            throw new common_1.UnauthorizedException('Invalid username or password');
        }
        const isPasswordValid = await argon2.verify(user.passwordHash, dto.password);
        if (!isPasswordValid) {
            throw new common_1.UnauthorizedException('Invalid username or password');
        }
        // Generate new sessionId and save to user
        const sessionId = (0, uuid_1.v4)();
        user.activeSessionId = sessionId;
        // Update last seen
        user.lastSeenAt = new Date();
        await this.userRepository.save(user);
        // Generate tokens with sessionId
        return this.generateTokens(user.id, user.username, sessionId);
    }
    async validateToken(token) {
        try {
            const payload = this.jwtService.verify(token);
            return payload;
        }
        catch {
            return null;
        }
    }
    generateTokens(userId, username, sessionId) {
        const accessToken = this.jwtService.sign({
            userId,
            username,
            sessionId,
            type: 'access',
        }, { expiresIn: '15m' }); // 15 minutes
        const refreshToken = this.jwtService.sign({
            userId,
            sessionId,
            type: 'refresh',
        }, { expiresIn: '7d' }); // 7 days
        return {
            accessToken,
            refreshToken,
            expiresIn: 15 * 60, // 900 seconds (access token TTL)
        };
    }
    hashCpf(cpf) {
        const pepper = process.env.CPF_PEPPER || 'default_pepper_change_in_production';
        return crypto.createHmac('sha256', pepper).update(cpf).digest('hex');
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.User)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        jwt_1.JwtService])
], AuthService);
//# sourceMappingURL=auth.service.js.map