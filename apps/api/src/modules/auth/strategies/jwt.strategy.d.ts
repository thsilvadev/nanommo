import { Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '@/database/entities';
declare const JwtStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtStrategy extends JwtStrategy_base {
    private userRepository;
    constructor(userRepository: Repository<User>);
    validate(payload: any): Promise<{
        userId: any;
        username: any;
        sessionId: any;
    }>;
}
export {};
//# sourceMappingURL=jwt.strategy.d.ts.map