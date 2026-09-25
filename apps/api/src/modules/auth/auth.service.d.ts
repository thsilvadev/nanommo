import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { User } from '@/database/entities';
import { RegisterDto, LoginDto, AuthTokenDto } from '@nanommo/shared';
export declare class AuthService {
    private userRepository;
    private jwtService;
    private readonly logger;
    constructor(userRepository: Repository<User>, jwtService: JwtService);
    register(dto: RegisterDto): Promise<AuthTokenDto>;
    login(dto: LoginDto): Promise<AuthTokenDto>;
    validateToken(token: string): Promise<{
        userId: string;
        username: string;
    } | null>;
    private generateTokens;
    private hashCpf;
}
//# sourceMappingURL=auth.service.d.ts.map