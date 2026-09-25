import { User } from './user.entity';
export declare class ChatReport {
    id: string;
    reporterUserId: string;
    reporterUser?: User;
    reportedUserId: string;
    reportedUser?: User;
    messageSnapshot: string;
    createdAt: Date;
}
//# sourceMappingURL=chat-report.entity.d.ts.map