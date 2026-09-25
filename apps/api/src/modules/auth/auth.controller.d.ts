import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, AuthTokenDto } from '@nanommo/shared';
export declare class AuthController {
    private authService;
    constructor(authService: AuthService);
    register(dto: RegisterDto): Promise<AuthTokenDto>;
    login(dto: LoginDto): Promise<AuthTokenDto>;
}
//# sourceMappingURL=auth.controller.d.ts.map