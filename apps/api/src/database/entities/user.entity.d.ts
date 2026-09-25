export declare class User {
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    cpfHash: string;
    emailVerified: boolean;
    emailVerificationToken?: string;
    passwordResetToken?: string;
    passwordResetExpiresAt?: Date;
    activeSessionId?: string;
    isMuted: boolean;
    muteExpiresAt?: Date;
    lastSeenAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=user.entity.d.ts.map